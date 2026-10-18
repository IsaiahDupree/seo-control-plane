import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** LLM generation job history for this app. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const status = sp.get('status')
  const briefId = sp.get('brief_id')
  const articleId = sp.get('article_id')

  const admin = createAdminClient()
  let q = admin
    .from('scp_generation_jobs')
    .select(
      'id, brief_id, article_id, status, llm_provider, llm_model, total_tokens, cost_usd, error_message, started_at, completed_at, created_at'
    )
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) q = q.eq('status', status)
  if (briefId) q = q.eq('brief_id', briefId)
  if (articleId) q = q.eq('article_id', articleId)

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
