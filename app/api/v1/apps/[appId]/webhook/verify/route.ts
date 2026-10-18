// F-CP-007: Webhook endpoint verification (ping test)
// Sends a test delivery to the app's webhook_url and reports reachability + response.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { signPayload } from '@/lib/hmac'

type RouteContext = { params: Promise<{ appId: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, name, webhook_url, webhook_secret')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')
  if (!app.webhook_url) return jsonError(400, 'no_webhook_url', 'App has no webhook_url configured')

  const deliveryId = `verify_${Date.now()}`
  const payload = {
    event: 'ping',
    app_id: appId,
    delivery_id: deliveryId,
    timestamp: new Date().toISOString(),
    message: 'Webhook verification ping from SEO Control Plane',
  }

  const bodyStr = JSON.stringify(payload)
  const secret = (app.webhook_secret as string | null) ?? ''

  let signature = ''
  if (secret) {
    try {
      signature = await signPayload(bodyStr, secret)
    } catch {
      signature = ''
    }
  }

  const start = Date.now()
  let status: 'ok' | 'error' | 'timeout' = 'error'
  let httpStatus: number | null = null
  let responseBody: string | null = null
  let errorMessage: string | null = null

  try {
    const res = await fetch(app.webhook_url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SCP-Event': 'ping',
        'X-SCP-Delivery-ID': deliveryId,
        'X-SCP-App-ID': appId,
        ...(signature ? { 'X-SCP-Signature': signature } : {}),
      },
      body: bodyStr,
      signal: AbortSignal.timeout(10000),
    })

    httpStatus = res.status
    try {
      responseBody = await res.text()
    } catch { /* ignore */ }

    status = res.ok ? 'ok' : 'error'
    if (!res.ok) {
      errorMessage = `Webhook returned HTTP ${res.status}`
    }
  } catch (e) {
    status = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'error'
    errorMessage = e instanceof Error ? e.message : 'Unknown error'
  }

  const latency_ms = Date.now() - start

  return NextResponse.json({
    verified: status === 'ok',
    status,
    webhook_url: app.webhook_url,
    http_status: httpStatus,
    latency_ms,
    response_preview: responseBody ? responseBody.slice(0, 500) : null,
    error: errorMessage,
    delivery_id: deliveryId,
  })
}
