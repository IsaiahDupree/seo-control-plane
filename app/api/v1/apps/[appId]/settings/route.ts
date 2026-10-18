import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchAppSettingsBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const settingsReadColumns =
  'id, slug, name, base_url, domain, webhook_url, context, metadata, plan, status, monthly_article_limit, monthly_articles_generated, quota_reset_at, created_at, updated_at'

/** Read app configuration (no `webhook_secret`; rotate via PATCH only). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_apps')
    .select(settingsReadColumns)
    .eq('id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'App not found')

  return NextResponse.json({ app: data })
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

  const parsed = patchAppSettingsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: existing, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, name, base_url, domain, webhook_url, context, metadata, monthly_article_limit')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !existing) {
    return jsonError(404, 'not_found', 'App not found')
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.base_url !== undefined) patch.base_url = parsed.data.base_url
  if (parsed.data.domain !== undefined) patch.domain = parsed.data.domain
  if (parsed.data.webhook_url !== undefined) patch.webhook_url = parsed.data.webhook_url
  if (parsed.data.webhook_secret !== undefined) patch.webhook_secret = parsed.data.webhook_secret
  if (parsed.data.monthly_article_limit !== undefined)
    patch.monthly_article_limit = parsed.data.monthly_article_limit

  if (parsed.data.context !== undefined) {
    const prev =
      existing.context && typeof existing.context === 'object' && !Array.isArray(existing.context)
        ? (existing.context as Record<string, unknown>)
        : {}
    patch.context = { ...prev, ...parsed.data.context }
  }

  if (parsed.data.metadata !== undefined) {
    const prev =
      existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {}
    patch.metadata = { ...prev, ...parsed.data.metadata }
  }

  const { data: updated, error: updErr } = await admin
    .from('scp_apps')
    .update(patch)
    .eq('id', appId)
    .select(
      'id, slug, name, base_url, domain, webhook_url, context, metadata, plan, status, monthly_article_limit, updated_at'
    )
    .single()

  if (updErr || !updated) {
    return jsonError(500, 'update_failed', updErr?.message ?? 'Update failed')
  }

  const before: Record<string, unknown> = {}
  const p = parsed.data
  if (p.name !== undefined) before.name = existing.name
  if (p.base_url !== undefined) before.base_url = existing.base_url
  if (p.domain !== undefined) before.domain = existing.domain
  if (p.webhook_url !== undefined) before.webhook_url = existing.webhook_url
  if (p.monthly_article_limit !== undefined)
    before.monthly_article_limit = existing.monthly_article_limit
  if (p.context !== undefined) before.context = existing.context
  if (p.metadata !== undefined) before.metadata = existing.metadata

  const changes: Record<string, unknown> = { ...p }
  if (p.webhook_secret !== undefined) {
    delete changes.webhook_secret
    changes.webhook_secret_rotated = true
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'app.settings_updated',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      before,
      changes,
    },
  })

  return NextResponse.json({
    app: updated,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
