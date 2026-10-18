import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** List ingested analytics events (newest first). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const articleId = sp.get('article_id')
  const eventName = sp.get('event_name')
  const from = sp.get('from')
  const to = sp.get('to')

  const admin = createAdminClient()
  let q = admin
    .from('scp_analytics_events')
    .select('id, article_id, event_name, payload, client_event_id, occurred_at, created_at')
    .eq('app_id', appId)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (articleId) q = q.eq('article_id', articleId)
  if (eventName) q = q.eq('event_name', eventName)
  if (from) q = q.gte('occurred_at', from)
  if (to) q = q.lte('occurred_at', to)

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
