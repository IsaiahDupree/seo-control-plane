// F-CP-035: Minimum quality gates configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const qualityGatesBody = z.object({
  min_word_count: z.number().int().min(100).max(10000).optional(),
  min_qa_score: z.number().min(0).max(100).optional(),
  require_focus_keyword: z.boolean().optional(),
  require_meta_description: z.boolean().optional(),
  require_internal_links: z.boolean().optional(),
  min_internal_links: z.number().int().min(0).max(20).optional(),
  require_schema_markup: z.boolean().optional(),
  block_publish_below_score: z.boolean().optional(),
})

const DEFAULT_GATES = {
  min_word_count: 800,
  min_qa_score: 70,
  require_focus_keyword: true,
  require_meta_description: true,
  require_internal_links: true,
  min_internal_links: 2,
  require_schema_markup: false,
  block_publish_below_score: true,
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
  const stored = ctx.quality_gates ?? null

  return NextResponse.json({
    quality_gates: stored ? { ...DEFAULT_GATES, ...(stored as object) } : DEFAULT_GATES,
    is_default: !stored,
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

  const parsed = qualityGatesBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
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

  const prevGates =
    prevCtx.quality_gates && typeof prevCtx.quality_gates === 'object'
      ? (prevCtx.quality_gates as Record<string, unknown>)
      : {}

  const updatedGates = { ...DEFAULT_GATES, ...prevGates, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, quality_gates: updatedGates }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'quality_gates',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ quality_gates: updatedGates }, { status: 200 })
}
