import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { deliverArticle } from '@/lib/deliver'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const bodySchema = z.object({
  article_id: z.string().uuid(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const result = await deliverArticle(parsed.data.article_id, appId)

  if (!result.success) {
    const notFound = result.error === 'Article not found' || result.error === 'App not found'
    return jsonError(notFound ? 404 : 500, 'delivery_failed', result.error ?? 'Delivery failed')
  }

  const admin = createAdminClient()
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'article.delivered',
    entity_type: 'article',
    entity_id: parsed.data.article_id,
    performed_by: null,
    payload: {
      source: 'api_key',
      delivery_id: result.deliveryId,
    },
  })

  return NextResponse.json({
    delivery_id: result.deliveryId,
    article_id: parsed.data.article_id,
    status: 'delivered',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
