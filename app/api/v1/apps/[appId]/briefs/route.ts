import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** List content briefs. Default `status=pending`; use `all_statuses=1` to list every status, or pass `status=`. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const allStatuses = sp.get('all_statuses') === '1'
  const statusFilter = sp.get('status')

  const admin = createAdminClient()
  let q = admin
    .from('scp_content_briefs')
    .select(
      'id, keyword_id, article_id, content_request_id, focus_keyword, secondary_keywords, content_type, cluster_name, target_word_count, target_persona, status, created_at'
    )
    .eq('app_id', appId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (statusFilter) {
    q = q.eq('status', statusFilter)
  } else if (!allStatuses) {
    q = q.eq('status', 'pending')
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
