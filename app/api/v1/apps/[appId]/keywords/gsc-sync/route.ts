import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { z } from 'zod'

type RouteContext = { params: Promise<{ appId: string }> }

const gscRowSchema = z.object({
  keyword: z.string().min(1),
  clicks: z.number().int().min(0).optional(),
  impressions: z.number().int().min(0).optional(),
  ctr: z.number().min(0).max(1).optional(),
  position: z.number().min(0).optional(),
  search_volume: z.number().int().min(0).optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  cpc_usd: z.number().min(0).optional(),
  intent: z.enum(['informational', 'navigational', 'commercial', 'transactional']).optional(),
  cluster_name: z.string().optional(),
  is_seed: z.boolean().optional(),
})

const bodySchema = z.object({
  rows: z.array(gscRowSchema).min(1).max(2000),
})

/**
 * POST /keywords/gsc-sync
 * Accepts a batch of GSC query rows (from a cron job or manual push) and
 * upserts them into scp_keywords, updating search metrics on conflict.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const now = new Date().toISOString()

  const rows = parsed.data.rows.map((r) => ({
    app_id: appId,
    keyword: r.keyword.trim().toLowerCase(),
    search_volume: r.search_volume ?? null,
    difficulty: r.difficulty ?? null,
    cpc_usd: r.cpc_usd ?? null,
    intent: r.intent ?? null,
    cluster_name: r.cluster_name ?? null,
    is_seed: r.is_seed ?? false,
    last_refreshed_at: now,
  }))

  const admin = createAdminClient()

  // Upsert keywords — preserve existing cluster/status on conflict
  const { data, error } = await admin
    .from('scp_keywords')
    .upsert(rows, {
      onConflict: 'app_id,keyword',
      ignoreDuplicates: false,
    })
    .select('id, keyword, cluster_name, search_volume, difficulty, status')

  if (error) return jsonError(500, 'upsert_failed', error.message)

  const perfRows = parsed.data.rows
    .filter((r) => r.clicks !== undefined && r.impressions !== undefined)
    .map((r) => ({
      app_id: appId,
      gsc_query: r.keyword.trim().toLowerCase(),
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? null,
      position: r.position ?? null,
      date: now.slice(0, 10),
    }))

  let gsc_performance_synced = 0
  if (perfRows.length > 0) {
    const { data: perfData, error: perfErr } = await admin
      .from('scp_gsc_performance')
      .upsert(perfRows, { onConflict: 'app_id,gsc_query,date' })
      .select('id')

    if (perfErr) {
      return jsonError(500, 'gsc_perf_upsert_failed', perfErr.message)
    }
    gsc_performance_synced = perfData?.length ?? perfRows.length
  }

  const keywords_synced = data?.length ?? rows.length
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'keywords.gsc_sync',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      row_count: parsed.data.rows.length,
      keywords_synced,
      gsc_performance_synced,
    },
  })

  return NextResponse.json({
    keywords_synced,
    gsc_performance_synced,
    items: data ?? [],
    ...(audit_warning ? { audit_warning } : {}),
  })
}
