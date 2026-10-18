import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; deliveryId: string }> }

const deliveryColumns =
  'id, article_id, version, status, delivery_type, payload_size_bytes, attempts, last_attempt_at, delivered_at, confirmed_at, error_message, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, deliveryId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_deliveries')
    .select(deliveryColumns)
    .eq('id', deliveryId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Delivery not found')

  return NextResponse.json({ delivery: data })
}
