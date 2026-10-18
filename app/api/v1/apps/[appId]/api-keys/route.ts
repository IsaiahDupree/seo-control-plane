import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { createApiKeyBody } from '@/lib/schemas'
import { generateApiKey, hashKey } from '@/lib/api-key'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const keyListColumns = 'id, key_prefix, label, revoked_at, last_used_at, created_at'

/** List API keys (metadata only; never full secrets). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_api_keys')
    .select(keyListColumns)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ keys: data ?? [] })
}

/**
 * Mint a new key. Plaintext is returned once in `api_key` (same pattern as POST /api/apps/register).
 * Max 20 keys per app (including revoked) to avoid unbounded growth.
 */
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

  const parsed = createApiKeyBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { count, error: cErr } = await admin
    .from('scp_api_keys')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)

  if (cErr) return jsonError(500, 'query_failed', cErr.message)
  if ((count ?? 0) >= 20) {
    return jsonError(400, 'key_limit', 'Maximum API keys per app reached (20)')
  }

  const rawKey = generateApiKey()
  const keyHash = await hashKey(rawKey)
  const keyPrefix = rawKey.slice(0, 12)
  const label = parsed.data.label?.trim() || 'additional'

  const { data: row, error: insErr } = await admin
    .from('scp_api_keys')
    .insert({
      app_id: appId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label,
    })
    .select(keyListColumns)
    .single()

  if (insErr || !row) {
    return jsonError(500, 'insert_failed', insErr?.message ?? 'Failed to create key')
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'api_key.created',
    entity_type: 'api_key',
    entity_id: row.id,
    performed_by: null,
    payload: {
      label: row.label,
      key_prefix: row.key_prefix,
      source: 'api_key',
    },
  })

  return NextResponse.json({
    key: row,
    api_key: rawKey,
    message: 'Store api_key securely; it is shown only once.',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
