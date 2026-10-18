import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const EVENT_TYPES = new Set([
  'delivered',
  'published',
  'indexnow_pinged',
  'gsc_submitted',
  'indexed_confirmed',
  'unpublished',
  'archived',
  'redirected',
])

/** Delivery / publish / IndexNow audit trail for an app. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '30', 10) || 30))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const eventType = sp.get('event_type')

  if (eventType && !EVENT_TYPES.has(eventType)) {
    return jsonError(400, 'validation_error', `Invalid event_type`)
  }

  const admin = createAdminClient()
  let q = admin
    .from('scp_publish_logs')
    .select(
      'id, article_id, delivery_id, event_type, response_data, occurred_at'
    )
    .eq('app_id', appId)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (eventType) {
    q = q.eq('event_type', eventType)
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
