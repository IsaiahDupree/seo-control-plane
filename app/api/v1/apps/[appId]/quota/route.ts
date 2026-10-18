// F-CP-021: Quota override endpoint (admin — service-role only)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const quotaBody = z.object({
  monthly_article_limit: z.number().int().min(0).max(10000).optional(),
  monthly_articles_generated: z.number().int().min(0).optional(),
  reset_monthly_count: z.boolean().default(false),
  reason: z.string().max(500).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error } = await admin
    .from('scp_apps')
    .select('id, plan, monthly_article_limit, monthly_articles_generated, quota_reset_at')
    .eq('id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!app) return jsonError(404, 'not_found', 'App not found')

  const limit = app.monthly_article_limit ?? 10
  const used = app.monthly_articles_generated ?? 0

  return NextResponse.json({
    plan: app.plan,
    monthly_article_limit: limit,
    monthly_articles_generated: used,
    monthly_remaining: Math.max(0, limit - used),
    quota_reset_at: app.quota_reset_at,
  })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = quotaBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const updatePayload: Record<string, unknown> = { updated_at: now }
  if (parsed.data.monthly_article_limit !== undefined) {
    updatePayload.monthly_article_limit = parsed.data.monthly_article_limit
  }
  if (parsed.data.reset_monthly_count) {
    updatePayload.monthly_articles_generated = 0
    updatePayload.quota_reset_at = now
  } else if (parsed.data.monthly_articles_generated !== undefined) {
    updatePayload.monthly_articles_generated = parsed.data.monthly_articles_generated
  }

  const { data, error: updateErr } = await admin
    .from('scp_apps')
    .update(updatePayload)
    .eq('id', appId)
    .select('id, monthly_article_limit, monthly_articles_generated, quota_reset_at')
    .single()

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'quota.overridden',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { changes: parsed.data },
  })

  return NextResponse.json({ quota: data })
}
