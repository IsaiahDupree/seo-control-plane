import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { generateApiKey, hashKey } from '@/lib/api-key'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

const bodySchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(200),
  base_url: z.string().url().optional(),
  webhook_url: z.string().url().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  register_secret: z.string().min(8),
})

export async function POST(request: NextRequest) {
  const secret = process.env.SCP_REGISTER_SECRET
  if (!secret) {
    return jsonError(503, 'register_disabled', 'SCP_REGISTER_SECRET is not configured')
  }

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

  if (parsed.data.register_secret !== secret) {
    return jsonError(401, 'unauthorized', 'Invalid register_secret')
  }

  const admin = createAdminClient()
  const { data: existing } = await admin.from('scp_apps').select('id').eq('slug', parsed.data.slug).maybeSingle()
  if (existing) {
    return jsonError(409, 'slug_taken', 'An app with this slug already exists')
  }

  const { data: app, error: appErr } = await admin
    .from('scp_apps')
    .insert({
      slug: parsed.data.slug,
      name: parsed.data.name,
      base_url: parsed.data.base_url ?? null,
      webhook_url: parsed.data.webhook_url ?? null,
      context: parsed.data.context ?? {},
    })
    .select('id, slug, name')
    .single()

  if (appErr || !app) {
    return jsonError(500, 'insert_failed', appErr?.message ?? 'Failed to create app')
  }

  const rawKey = generateApiKey()
  const keyHash = await hashKey(rawKey)
  const keyPrefix = rawKey.slice(0, 12)

  const { data: keyRow, error: keyErr } = await admin
    .from('scp_api_keys')
    .insert({
      app_id: app.id,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: 'default',
    })
    .select('id')
    .single()

  if (keyErr || !keyRow) {
    await admin.from('scp_apps').delete().eq('id', app.id)
    return jsonError(500, 'key_insert_failed', keyErr?.message ?? 'Failed to create API key')
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: app.id,
    action: 'app.registered',
    entity_type: 'app',
    entity_id: app.id,
    performed_by: null,
    payload: {
      source: 'register_secret',
      slug: app.slug,
      name: app.name,
      has_base_url: Boolean(parsed.data.base_url),
      has_webhook_url: Boolean(parsed.data.webhook_url),
      default_key_id: keyRow.id,
      default_key_prefix: keyPrefix,
    },
  })

  return NextResponse.json({
    app: { id: app.id, slug: app.slug, name: app.name },
    api_key: rawKey,
    message: 'Store api_key securely; it is shown only once.',
    ...(audit_warning ? { audit_warning } : {}),
  })
}
