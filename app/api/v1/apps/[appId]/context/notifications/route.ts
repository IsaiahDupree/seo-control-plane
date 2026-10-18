// F-CP-039: Notification preferences configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const notificationsBody = z.object({
  webhook_on_publish: z.boolean().optional(),
  webhook_on_error: z.boolean().optional(),
  webhook_on_quota_warning: z.boolean().optional(),
  quota_warning_threshold_pct: z.number().int().min(50).max(99).optional(),
  email_on_publish: z.boolean().optional(),
  email_on_error: z.boolean().optional(),
  notify_email: z.string().email().optional().nullable(),
  slack_webhook_url: z.string().url().optional().nullable(),
  slack_on_publish: z.boolean().optional(),
  slack_on_error: z.boolean().optional(),
})

const DEFAULT_PREFS = {
  webhook_on_publish: true,
  webhook_on_error: true,
  webhook_on_quota_warning: true,
  quota_warning_threshold_pct: 80,
  email_on_publish: false,
  email_on_error: false,
  notify_email: null,
  slack_webhook_url: null,
  slack_on_publish: false,
  slack_on_error: false,
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!app) return jsonError(404, 'not_found', 'App not found')

  const ctx = (app.context && typeof app.context === 'object' ? app.context : {}) as Record<string, unknown>
  const stored = ctx.notifications ?? null

  return NextResponse.json({
    notifications: stored ? { ...DEFAULT_PREFS, ...(stored as object) } : DEFAULT_PREFS,
  })
}

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

  const parsed = notificationsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx =
    app.context && typeof app.context === 'object' && !Array.isArray(app.context)
      ? (app.context as Record<string, unknown>)
      : {}

  const prevNotifs =
    prevCtx.notifications && typeof prevCtx.notifications === 'object'
      ? (prevCtx.notifications as Record<string, unknown>)
      : {}

  const updated = { ...DEFAULT_PREFS, ...prevNotifs, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, notifications: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'notifications',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ notifications: updated }, { status: 200 })
}
