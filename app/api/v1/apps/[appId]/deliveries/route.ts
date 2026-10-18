import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** Webhook delivery attempts for an app. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '30', 10) || 30))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const status = sp.get('status')

  const admin = createAdminClient()
  let q = admin
    .from('scp_deliveries')
    .select(
      'id, article_id, version, status, delivery_type, attempts, last_attempt_at, delivered_at, error_message, created_at'
    )
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    q = q.eq('status', status)
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
