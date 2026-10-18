import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** Pending / scheduled publish slots for this app (via article ownership). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const status = sp.get('status')

  const admin = createAdminClient()
  let q = admin
    .from('scp_publish_queue')
    .select(
      'id, article_id, position, scheduled_for, status, created_at, scp_articles!inner(app_id, slug, title)'
    )
    .eq('scp_articles.app_id', appId)
    .order('scheduled_for', { ascending: true })
    .range(offset, offset + limit - 1)

  if (status) {
    q = q.eq('status', status)
  }

  const { data, error } = await q

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }

  const items = data ?? []
  return NextResponse.json({
    items,
    limit,
    offset,
    has_more: items.length === limit,
  })
}
