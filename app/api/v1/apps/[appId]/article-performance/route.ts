import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { articlePerformanceSyncBody } from '@/lib/schemas'

type RouteContext = { params: Promise<{ appId: string }> }

/** List daily `scp_article_performance` rows for this app. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '60', 10) || 60))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const articleId = sp.get('article_id')
  const from = sp.get('from')
  const to = sp.get('to')

  const admin = createAdminClient()
  let q = admin
    .from('scp_article_performance')
    .select(
      'id, article_id, date, sessions, pageviews, avg_scroll_depth, reads_complete, cta_clicks, conversions, attributed_revenue_usd, avg_position, impressions, clicks, ctr, created_at'
    )
    .eq('app_id', appId)
    .order('date', { ascending: false })
    .order('article_id')
    .range(offset, offset + limit - 1)

  if (articleId) q = q.eq('article_id', articleId)
  if (from) q = q.gte('date', from)
  if (to) q = q.lte('date', to)

  const { data, error } = await q

  if (error) return jsonError(500, 'query_failed', error.message)

  const items = data ?? []
  return NextResponse.json({
    items,
    limit,
    offset,
    has_more: items.length === limit,
  })
}

/**
 * Upsert daily aggregates (e.g. from your analytics warehouse or edge worker).
 * Conflicts on `(article_id, date)`.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = articlePerformanceSyncBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const ids = [...new Set(parsed.data.rows.map((r) => r.article_id))]
  const admin = createAdminClient()
  const { data: owned, error: ownErr } = await admin
    .from('scp_articles')
    .select('id')
    .eq('app_id', appId)
    .in('id', ids)

  if (ownErr) return jsonError(500, 'query_failed', ownErr.message)
  const ok = new Set((owned ?? []).map((r) => r.id as string))
  if (ids.some((id) => !ok.has(id))) {
    return jsonError(400, 'article_mismatch', 'One or more article_ids do not belong to this app')
  }

  const rows = parsed.data.rows.map((r) => ({
    app_id: appId,
    article_id: r.article_id,
    date: r.date,
    sessions: r.sessions,
    pageviews: r.pageviews,
    avg_scroll_depth: r.avg_scroll_depth ?? null,
    reads_complete: r.reads_complete,
    cta_clicks: r.cta_clicks,
    conversions: r.conversions,
    attributed_revenue_usd: r.attributed_revenue_usd,
    avg_position: r.avg_position ?? null,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr ?? null,
  }))

  const { data, error } = await admin
    .from('scp_article_performance')
    .upsert(rows, { onConflict: 'article_id,date', ignoreDuplicates: false })
    .select('id, article_id, date')

  if (error) return jsonError(500, 'upsert_failed', error.message)

  const upserted = data?.length ?? rows.length
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'article_performance.sync',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      row_count: rows.length,
      upserted,
      distinct_articles: ids.length,
    },
  })

  return NextResponse.json({
    upserted,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
