// F-CP-014: App transfer / ownership change
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const transferBody = z.object({
  new_owner_user_id: z.string().uuid(),
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
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = transferBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, name, owner_id, status')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')
  if (app.status === 'inactive') return jsonError(409, 'app_inactive', 'Cannot transfer an inactive app')

  const previousOwnerId = app.owner_id as string | null
  const now = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ owner_id: parsed.data.new_owner_user_id, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'app.ownership_transferred',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      previous_owner_id: previousOwnerId,
      new_owner_id: parsed.data.new_owner_user_id,
      reason: parsed.data.reason ?? null,
    },
  })

  return NextResponse.json({
    transferred: true,
    app_id: appId,
    previous_owner_id: previousOwnerId,
    new_owner_id: parsed.data.new_owner_user_id,
    transferred_at: now,
  })
}
