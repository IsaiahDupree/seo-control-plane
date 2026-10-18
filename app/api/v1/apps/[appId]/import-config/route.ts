// Import app configuration — restore context and keywords from an export payload
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const importBody = z.object({
  context: z.record(z.string(), z.unknown()).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  keywords: z.array(z.object({
    keyword: z.string().max(500),
    cluster_name: z.string().max(200).optional(),
    intent_type: z.string().max(50).optional(),
    search_volume: z.number().int().optional(),
    status: z.string().max(50).optional(),
  })).max(5000).optional(),
  merge_strategy: z.enum(['replace', 'merge']).default('merge'),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = importBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const results: Record<string, unknown> = {}

  // Update context/settings
  if (parsed.data.context !== undefined || parsed.data.settings !== undefined) {
    const { data: app, error: fetchErr } = await admin
      .from('scp_apps')
      .select('context, settings')
      .eq('id', appId)
      .maybeSingle()

    if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

    const prevCtx = (app.context && typeof app.context === 'object' && !Array.isArray(app.context))
      ? (app.context as Record<string, unknown>) : {}
    const prevSettings = (app.settings && typeof app.settings === 'object' && !Array.isArray(app.settings))
      ? (app.settings as Record<string, unknown>) : {}

    const newCtx = parsed.data.merge_strategy === 'merge'
      ? { ...prevCtx, ...parsed.data.context }
      : (parsed.data.context ?? prevCtx)
    const newSettings = parsed.data.merge_strategy === 'merge'
      ? { ...prevSettings, ...parsed.data.settings }
      : (parsed.data.settings ?? prevSettings)

    const { error } = await admin
      .from('scp_apps')
      .update({ context: newCtx, settings: newSettings, updated_at: now })
      .eq('id', appId)

    if (error) return jsonError(500, 'update_failed', error.message)
    results.context_updated = true
  }

  // Import keywords
  if (parsed.data.keywords && parsed.data.keywords.length > 0) {
    const rows = parsed.data.keywords.map((k) => ({
      app_id: appId,
      keyword: k.keyword,
      cluster_name: k.cluster_name ?? null,
      intent_type: k.intent_type ?? null,
      search_volume: k.search_volume ?? null,
      status: k.status ?? 'active',
      created_at: now,
      updated_at: now,
    }))

    const { error: kwErr } = await admin
      .from('scp_keywords')
      .upsert(rows, { onConflict: 'app_id,keyword', ignoreDuplicates: false })

    if (kwErr) return jsonError(500, 'keyword_import_failed', kwErr.message)
    results.keywords_imported = rows.length
  }

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'config_import',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { merge_strategy: parsed.data.merge_strategy, results },
  })

  return NextResponse.json({ imported_at: now, ...results })
}
