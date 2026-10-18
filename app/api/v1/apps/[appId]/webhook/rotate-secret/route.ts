// F-CP-010: Webhook secret rotation
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return 'whsec_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, name, webhook_secret')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const newSecret = generateSecret()
  const now = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ webhook_secret: newSecret, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'webhook.secret_rotated',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { rotated_at: now },
  })

  return NextResponse.json({
    rotated: true,
    new_secret: newSecret,
    rotated_at: now,
    note: 'Update your app to use the new secret immediately. The old secret is no longer valid.',
  })
}
