// F-CP-013: App deactivation / reactivation
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const deactivateBody = z.object({
  reason: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    json = {}
  }

  const parsed = deactivateBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, name, status')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')
  if (app.status === 'inactive') return jsonError(409, 'already_inactive', 'App is already inactive')

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ status: 'inactive', updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'app.deactivated',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { reason: parsed.data.reason ?? null, source: 'api_key' },
  })

  return NextResponse.json({ deactivated: true, app_id: appId, deactivated_at: now })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, status')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')
  if (app.status === 'active') return jsonError(409, 'already_active', 'App is already active')

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ status: 'active', updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'app.reactivated',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { source: 'api_key' },
  })

  return NextResponse.json({ reactivated: true, app_id: appId, reactivated_at: now })
}
