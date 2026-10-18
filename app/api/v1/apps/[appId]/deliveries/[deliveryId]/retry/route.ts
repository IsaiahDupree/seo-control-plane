import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { deliverArticle } from '@/lib/deliver'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; deliveryId: string }> }

/**
 * After a failed webhook delivery, trigger a new delivery attempt (new row + HTTP post).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, deliveryId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('scp_deliveries')
    .select('id, article_id, status')
    .eq('id', deliveryId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!row) return jsonError(404, 'not_found', 'Delivery not found')

  if (row.status !== 'failed') {
    return jsonError(409, 'not_retryable', `Only failed deliveries can be retried (status: ${row.status})`)
  }

  const outcome = await deliverArticle(row.article_id as string, appId)

  if (!outcome.success) {
    return jsonError(502, 'delivery_failed', outcome.error ?? 'Delivery failed', {
      delivery_id: outcome.deliveryId,
    })
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'delivery.retried',
    entity_type: 'delivery',
    entity_id: deliveryId,
    performed_by: null,
    payload: {
      source: 'api_key',
      article_id: row.article_id,
      new_delivery_id: outcome.deliveryId,
    },
  })

  return NextResponse.json({
    delivery_id: outcome.deliveryId,
    article_id: row.article_id,
    status: 'delivered',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
