import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const listColumns =
  'id, slug, title, description, status, focus_keyword, content_type, cluster_name, word_count, qa_score, scheduled_publish_at, published_at, created_at, updated_at'

/** Paginated article list for operators and sync tools. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10) || 25))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const statusParam = sp.get('status')
  const statuses = statusParam
    ? statusParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null
  const slug = sp.get('slug')
  const focusKeyword = sp.get('focus_keyword')

  const admin = createAdminClient()
  let q = admin
    .from('scp_articles')
    .select(listColumns)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (statuses?.length) {
    q = q.in('status', statuses)
  }
  if (slug) {
    q = q.eq('slug', slug)
  }
  if (focusKeyword) {
    q = q.eq('focus_keyword', focusKeyword)
  }

  const { data, error } = await q

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }

  return NextResponse.json({
    items: data ?? [],
    limit,
    offset,
    has_more: (data?.length ?? 0) === limit,
  })
}
