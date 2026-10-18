// F-CP-040: Webhook delivery history
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const status = searchParams.get('status') // 'delivered', 'failed', 'pending'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500)
  const articleId = searchParams.get('article_id')

  const admin = createAdminClient()

  let query = admin
    .from('scp_deliveries')
    .select(
      'id, article_id, status, attempt_count, last_attempt_at, delivered_at, error_message, response_status, created_at'
    )
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (articleId) query = query.eq('article_id', articleId)

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  // Summary counts
  const [deliveredRes, failedRes, pendingRes] = await Promise.all([
    admin
      .from('scp_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'delivered'),
    admin
      .from('scp_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'failed'),
    admin
      .from('scp_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'pending'),
  ])

  return NextResponse.json({
    deliveries: data ?? [],
    total: data?.length ?? 0,
    summary: {
      delivered: deliveredRes.count ?? 0,
      failed: failedRes.count ?? 0,
      pending: pendingRes.count ?? 0,
    },
  })
}
