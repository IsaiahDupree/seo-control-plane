// F-CP-006: App health check endpoint
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

async function testWebhookReachability(
  webhookUrl: string
): Promise<{ reachable: boolean; latency_ms: number | null; error?: string }> {
  if (!webhookUrl) return { reachable: false, latency_ms: null, error: 'no_webhook_url' }
  const start = Date.now()
  try {
    const res = await fetch(webhookUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    })
    return { reachable: res.ok || res.status < 500, latency_ms: Date.now() - start }
  } catch (e) {
    return {
      reachable: false,
      latency_ms: Date.now() - start,
      error: e instanceof Error ? e.message : 'timeout',
    }
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  // Fetch app record
  const { data: app, error: appErr } = await admin
    .from('scp_apps')
    .select('id, name, status, webhook_url, created_at, updated_at')
    .eq('id', appId)
    .maybeSingle()

  if (appErr || !app) return jsonError(404, 'not_found', 'App not found')

  // Run parallel queries
  const [
    syncLogsResult,
    queueDepthResult,
    pendingJobsResult,
    recentDeliveriesResult,
    contextResult,
  ] = await Promise.all([
    // Last context sync per type
    admin
      .from('scp_app_sync_logs')
      .select('sync_type, version, created_at')
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .limit(10),

    // Queue depth: pending generation jobs
    admin
      .from('scp_articles')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'pending'),

    // Pending briefs
    admin
      .from('scp_briefs')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'pending'),

    // Last 3 delivery outcomes
    admin
      .from('scp_deliveries')
      .select('id, status, created_at, error_message')
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .limit(3),

    // Context completeness check
    Promise.all([
      admin.from('scp_app_features').select('id').eq('app_id', appId).maybeSingle(),
      admin.from('scp_app_personas').select('id', { count: 'exact', head: true }).eq('app_id', appId),
      admin.from('scp_app_ctas').select('id', { count: 'exact', head: true }).eq('app_id', appId),
      admin.from('scp_app_restrictions').select('id').eq('app_id', appId).maybeSingle(),
      admin.from('scp_app_publishing').select('id').eq('app_id', appId).maybeSingle(),
    ]),
  ])

  // Summarise last sync times per type
  const lastSyncByType: Record<string, string> = {}
  for (const log of syncLogsResult.data ?? []) {
    if (!lastSyncByType[log.sync_type]) {
      lastSyncByType[log.sync_type] = log.created_at
    }
  }

  // Context completeness score (F-CP-016 preview)
  const [featuresRes, personasRes, ctasRes, restrictionsRes, publishingRes] = contextResult
  const hasProduct = !!featuresRes.data
  const personaCount = personasRes.count ?? 0
  const ctaCount = ctasRes.count ?? 0
  const hasRestrictions = !!restrictionsRes.data
  const hasPublishing = !!publishingRes.data

  const contextScore =
    (hasProduct ? 20 : 0) +
    (personaCount > 0 ? 20 : 0) +
    (ctaCount > 0 ? 20 : 0) +
    (hasRestrictions ? 20 : 0) +
    (hasPublishing ? 10 : 0)
  // keyword seeds: 10 — checked via scp_keywords separately if needed

  // Webhook reachability (skip in test mode)
  const skipWebhook = request.nextUrl.searchParams.get('skip_webhook') === 'true'
  const webhookCheck = skipWebhook
    ? { reachable: null, latency_ms: null, skipped: true }
    : await testWebhookReachability(app.webhook_url ?? '')

  const health = {
    app_id: appId,
    app_name: app.name,
    status: app.status,
    registry: {
      registered: true,
      created_at: app.created_at,
      last_settings_update: app.updated_at,
    },
    context: {
      score: contextScore,
      score_max: 90,
      has_product: hasProduct,
      persona_count: personaCount,
      cta_count: ctaCount,
      has_restrictions: hasRestrictions,
      has_publishing_window: hasPublishing,
      last_sync_by_type: lastSyncByType,
    },
    queue: {
      pending_articles: queueDepthResult.count ?? 0,
      pending_briefs: pendingJobsResult.count ?? 0,
    },
    webhook: {
      url: app.webhook_url ?? null,
      ...webhookCheck,
    },
    recent_deliveries: (recentDeliveriesResult.data ?? []).map((d) => ({
      id: d.id,
      status: d.status,
      created_at: d.created_at,
      error: d.error_message ?? null,
    })),
    checked_at: new Date().toISOString(),
  }

  const httpStatus = app.status === 'active' ? 200 : 503
  return NextResponse.json({ health }, { status: httpStatus })
}
