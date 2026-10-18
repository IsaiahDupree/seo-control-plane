import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { enqueueStaleArticles } from '@/lib/refresh-queue'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { z } from 'zod'

type RouteContext = { params: Promise<{ appId: string }> }

/** GET — list refresh queue items (default: `status=queued`; use `all_statuses=1` for every status). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = new URL(request.url)
  const allStatuses = searchParams.get('all_statuses') === '1'
  const statusFilter = searchParams.get('status')
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0)

  const db = createAdminClient()
  let q = db
    .from('scp_refresh_queue')
    .select(
      'id, article_id, reason, decay_signals, priority_score, status, queued_at, completed_at, scp_articles!article_id(slug, title)',
      { count: 'exact' }
    )
    .eq('app_id', appId)

  if (statusFilter) {
    q = q.eq('status', statusFilter)
  } else if (!allStatuses) {
    q = q.eq('status', 'queued')
  }

  const { data, error, count } = await q
    .order('priority_score', { ascending: false })
    .order('queued_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return jsonError(500, 'query_failed', error.message)

  const items = data ?? []
  return NextResponse.json({
    items,
    total: count ?? items.length,
    limit,
    offset,
    has_more: items.length === limit,
  })
}

const enqueueBody = z.object({
  stale_days: z.number().int().min(1).max(365).optional(),
  article_ids: z.array(z.string().uuid()).max(100).optional(),
})

/** POST — enqueue stale articles or specific article IDs for refresh */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = enqueueBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const db = createAdminClient()

  // Manually enqueue specific articles
  if (parsed.data.article_ids && parsed.data.article_ids.length > 0) {
    const ids = parsed.data.article_ids
    const { data: owned, error: ownErr } = await db
      .from('scp_articles')
      .select('id')
      .eq('app_id', appId)
      .in('id', ids)

    if (ownErr) return jsonError(500, 'query_failed', ownErr.message)
    const ok = new Set((owned ?? []).map((r) => r.id as string))
    if (ids.some((id) => !ok.has(id))) {
      return jsonError(400, 'article_mismatch', 'One or more article_ids do not belong to this app')
    }

    const rows = ids.map((id) => ({
      app_id: appId,
      article_id: id,
      reason: 'manual',
      decay_signals: ['manual'],
      priority_score: 90,
      status: 'queued',
    }))

    const { data, error } = await db
      .from('scp_refresh_queue')
      .insert(rows)
      .select('id')

    if (error) return jsonError(500, 'insert_failed', error.message)
    const enqueuedN = data?.length ?? rows.length
    const audit_warning = await tryInsertUserAudit(db, {
      app_id: appId,
      action: 'refresh.enqueue_manual',
      entity_type: 'app',
      entity_id: appId,
      performed_by: null,
      payload: {
        source: 'api_key',
        article_ids: ids,
        enqueued: enqueuedN,
      },
    })
    return NextResponse.json({
      enqueued: enqueuedN,
      mode: 'manual',
      ...(audit_warning ? { audit_warning } : {}),
    })
  }

  // Auto-detect stale articles
  const staleDays = parsed.data.stale_days ?? 90
  const { enqueued, skipped } = await enqueueStaleArticles(appId, staleDays)
  const audit_warning = await tryInsertUserAudit(db, {
    app_id: appId,
    action: 'refresh.enqueue_auto',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      stale_days: staleDays,
      enqueued,
      skipped,
    },
  })
  return NextResponse.json({
    enqueued,
    skipped,
    mode: 'auto',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
