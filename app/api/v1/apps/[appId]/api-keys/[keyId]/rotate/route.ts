// F-CP-023: API key rotation
// Invalidates the target key, generates a new one, sets a 24h grace period on the old key.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { generateApiKey, hashKey } from '@/lib/api-key'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; keyId: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, keyId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  // Verify target key exists and is active for this app
  const { data: target, error: tErr } = await admin
    .from('scp_api_keys')
    .select('id, key_prefix, label, revoked_at')
    .eq('id', keyId)
    .eq('app_id', appId)
    .maybeSingle()

  if (tErr) return jsonError(500, 'query_failed', tErr.message)
  if (!target) return jsonError(404, 'not_found', 'API key not found')
  if (target.revoked_at) return jsonError(409, 'already_revoked', 'Key is already revoked')

  const now = new Date()
  const graceExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  // Generate new key
  const rawKey = generateApiKey()
  const keyHash = await hashKey(rawKey)
  const keyPrefix = rawKey.slice(0, 12)

  // Insert new key
  const { data: newKeyRow, error: insErr } = await admin
    .from('scp_api_keys')
    .insert({
      app_id: appId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: target.label ?? 'rotated',
    })
    .select('id, key_prefix, label, created_at')
    .single()

  if (insErr || !newKeyRow) {
    return jsonError(500, 'insert_failed', insErr?.message ?? 'Failed to create replacement key')
  }

  // Revoke old key with grace period (expires_at used as grace marker; revoked_at stays null during grace)
  // We schedule the revocation by setting revoked_at to the grace expiry time
  const { error: revokeErr } = await admin
    .from('scp_api_keys')
    .update({ revoked_at: graceExpiry })
    .eq('id', keyId)
    .eq('app_id', appId)

  if (revokeErr) return jsonError(500, 'revoke_failed', revokeErr.message)

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'api_key.rotated',
    entity_type: 'api_key',
    entity_id: keyId,
    performed_by: null,
    payload: {
      old_key_prefix: target.key_prefix,
      new_key_prefix: keyPrefix,
      grace_expires_at: graceExpiry,
      source: 'api_key',
    },
  })

  return NextResponse.json({
    rotated: true,
    old_key: {
      id: keyId,
      key_prefix: target.key_prefix,
      grace_expires_at: graceExpiry,
      message: 'Old key valid for 24h grace period, then permanently revoked.',
    },
    new_key: {
      id: newKeyRow.id,
      key_prefix: newKeyRow.key_prefix,
      label: newKeyRow.label,
      created_at: newKeyRow.created_at,
    },
    api_key: rawKey,
    message: 'Store api_key securely; it is shown only once.',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
