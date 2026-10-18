// F-CP-038: Delivery retry — re-attempt a failed webhook delivery
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { signPayload } from '@/lib/hmac'

type RouteContext = { params: Promise<{ appId: string; deliveryId: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, deliveryId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  // Fetch delivery + article + app in parallel
  const [deliveryResult, appResult] = await Promise.all([
    admin
      .from('scp_deliveries')
      .select('id, article_id, status, attempt_count, payload')
      .eq('id', deliveryId)
      .eq('app_id', appId)
      .maybeSingle(),
    admin
      .from('scp_apps')
      .select('id, webhook_url, webhook_secret')
      .eq('id', appId)
      .maybeSingle(),
  ])

  if (deliveryResult.error) return jsonError(500, 'query_failed', deliveryResult.error.message)
  if (!deliveryResult.data) return jsonError(404, 'not_found', 'Delivery not found')
  if (appResult.error || !appResult.data) return jsonError(404, 'not_found', 'App not found')

  const delivery = deliveryResult.data
  const app = appResult.data

  if (delivery.status === 'delivered') {
    return jsonError(409, 'already_delivered', 'Delivery already succeeded — no retry needed')
  }

  if ((delivery.attempt_count ?? 0) >= 10) {
    return jsonError(429, 'max_attempts', 'Maximum retry attempts (10) reached')
  }

  if (!app.webhook_url) {
    return jsonError(400, 'no_webhook_url', 'App has no webhook_url configured')
  }

  // Build payload — use stored payload or fetch from article
  let bodyStr: string
  if (delivery.payload && typeof delivery.payload === 'object') {
    bodyStr = JSON.stringify(delivery.payload)
  } else {
    const { data: article } = await admin
      .from('scp_articles')
      .select('*')
      .eq('id', delivery.article_id)
      .maybeSingle()

    if (!article) return jsonError(404, 'article_not_found', 'Article for delivery not found')
    bodyStr = JSON.stringify(article)
  }

  const secret = (app.webhook_secret as string | null) ?? ''
  let signature = ''
  if (secret) {
    try {
      signature = await signPayload(bodyStr, secret)
    } catch { /* no signature */ }
  }

  const now = new Date().toISOString()
  const start = Date.now()
  let status: 'delivered' | 'failed' = 'failed'
  let httpStatus: number | null = null
  let errorMessage: string | null = null

  try {
    const res = await fetch(app.webhook_url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SCP-Delivery-ID': deliveryId,
        'X-SCP-App-ID': appId,
        'X-SCP-Retry': String((delivery.attempt_count ?? 0) + 1),
        ...(signature ? { 'X-SCP-Signature': signature } : {}),
      },
      body: bodyStr,
      signal: AbortSignal.timeout(15000),
    })

    httpStatus = res.status
    status = res.ok ? 'delivered' : 'failed'
    if (!res.ok) errorMessage = `HTTP ${res.status}`
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : 'Unknown error'
  }

  const latency_ms = Date.now() - start

  // Update delivery record
  const { error: updateErr } = await admin
    .from('scp_deliveries')
    .update({
      status,
      attempt_count: (delivery.attempt_count ?? 0) + 1,
      last_attempt_at: now,
      delivered_at: status === 'delivered' ? now : null,
      response_status: httpStatus,
      error_message: errorMessage,
    })
    .eq('id', deliveryId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({
    retried: true,
    delivery_id: deliveryId,
    status,
    http_status: httpStatus,
    latency_ms,
    attempt_count: (delivery.attempt_count ?? 0) + 1,
    error: errorMessage,
  })
}
