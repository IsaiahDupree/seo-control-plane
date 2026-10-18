import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { hashKey } from '@/lib/api-key'

type RouteContext = { params: Promise<{ appId: string; keyId: string }> }

/**
 * Revoke an API key (sets `revoked_at`). At least one other active key must remain.
 * Pass `Authorization` with a **different** key than the one being revoked.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId, keyId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const authHeader = request.headers.get('Authorization')
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!bearer) {
    return jsonError(401, 'unauthorized', 'Bearer token required')
  }

  const admin = createAdminClient()
  const currentHash = await hashKey(bearer)

  const { data: target, error: tErr } = await admin
    .from('scp_api_keys')
    .select('id, key_hash, revoked_at, key_prefix')
    .eq('id', keyId)
    .eq('app_id', appId)
    .maybeSingle()

  if (tErr) return jsonError(500, 'query_failed', tErr.message)
  if (!target) return jsonError(404, 'not_found', 'API key not found')
  if (target.revoked_at) {
    return jsonError(409, 'already_revoked', 'This key is already revoked')
  }

  if (target.key_hash === currentHash) {
    return jsonError(400, 'cannot_revoke_self', 'Use another active key to revoke this one')
  }

  const { count: activeCount, error: aErr } = await admin
    .from('scp_api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)
    .is('revoked_at', null)

  if (aErr) return jsonError(500, 'query_failed', aErr.message)
  if ((activeCount ?? 0) <= 1) {
    return jsonError(400, 'last_key', 'Cannot revoke the only active API key for this app')
  }

  const now = new Date().toISOString()
  const { error: uErr } = await admin
    .from('scp_api_keys')
    .update({ revoked_at: now })
    .eq('id', keyId)
    .eq('app_id', appId)
    .is('revoked_at', null)

  if (uErr) return jsonError(500, 'update_failed', uErr.message)

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'api_key.revoked',
    entity_type: 'api_key',
    entity_id: keyId,
    performed_by: null,
    payload: {
      key_prefix: target.key_prefix,
      source: 'api_key',
    },
  })

  return NextResponse.json({
    ok: true,
    revoked_at: now,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
