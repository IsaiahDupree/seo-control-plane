// F-CP-032: Internal link configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const internalLinkConfigBody = z.object({
  min_links_per_article: z.number().int().min(0).max(20).optional(),
  max_links_per_article: z.number().int().min(1).max(50).optional(),
  link_to_pillar_pages: z.boolean().optional(),
  link_to_recent_articles: z.boolean().optional(),
  avoid_linking_to_competitors: z.boolean().optional(),
  anchor_text_strategy: z.enum(['exact_match', 'partial_match', 'natural', 'mixed']).optional(),
  orphan_detection_enabled: z.boolean().optional(),
  max_links_per_destination: z.number().int().min(1).max(10).optional(),
})

const DEFAULTS = {
  min_links_per_article: 2,
  max_links_per_article: 8,
  link_to_pillar_pages: true,
  link_to_recent_articles: true,
  avoid_linking_to_competitors: true,
  anchor_text_strategy: 'mixed',
  orphan_detection_enabled: true,
  max_links_per_destination: 3,
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
  const stored = ctx.internal_link_config ?? null

  return NextResponse.json({
    internal_link_config: stored ? { ...DEFAULTS, ...(stored as object) } : DEFAULTS,
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

  const parsed = internalLinkConfigBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  if (
    parsed.data.min_links_per_article !== undefined &&
    parsed.data.max_links_per_article !== undefined &&
    parsed.data.min_links_per_article > parsed.data.max_links_per_article
  ) {
    return jsonError(400, 'invalid_range', 'min_links_per_article must be <= max_links_per_article')
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

  const prevConfig =
    prevCtx.internal_link_config && typeof prevCtx.internal_link_config === 'object'
      ? (prevCtx.internal_link_config as Record<string, unknown>)
      : {}

  const updated = { ...DEFAULTS, ...prevConfig, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, internal_link_config: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'internal_link_config',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ internal_link_config: updated }, { status: 200 })
}
