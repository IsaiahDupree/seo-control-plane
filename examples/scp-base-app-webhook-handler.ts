/**
 * Example: App Router route to receive article deliveries from the SEO Control Plane.
 *
 * Configure the app in SCP with PATCH /settings: `webhook_url` + `webhook_secret`.
 * SCP sends POST with JSON body and headers:
 *   X-SCP-Signature: sha256=<hmac-sha256-hex of raw body>
 *   X-SCP-Delivery-ID, X-SCP-App-ID
 *
 * Use the same secret to verify (see `verifySCPWebhook` in @authority-os/seo-control-plane-adapter).
 *
 * Place as: app/api/scp/webhook/route.ts (or similar) in your base app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifySCPWebhook } from '@authority-os/seo-control-plane-adapter'

export async function POST(request: NextRequest) {
  const secret = process.env.SCP_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const raw = await request.text()
  const sig = request.headers.get('X-SCP-Signature') ?? ''
  const ok = await verifySCPWebhook(raw, sig, secret)
  if (!ok) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const payload = JSON.parse(raw) as {
    delivery_id: string
    article_id: string
    slug: string
    title: string
    content_markdown: string
    meta_title?: string
    meta_description?: string
  }

  // Persist MDX/page, trigger ISR, etc. (your blog pipeline)
  console.info('[scp webhook]', payload.delivery_id, payload.slug)

  return NextResponse.json({ received: true, slug: payload.slug })
}
