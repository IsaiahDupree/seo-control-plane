// F-CP-064: Brief template configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const briefTemplateBody = z.object({
  target_word_count: z.number().int().min(300).max(10000).optional(),
  include_outline: z.boolean().optional(),
  include_faq: z.boolean().optional(),
  include_key_takeaways: z.boolean().optional(),
  include_meta_description: z.boolean().optional(),
  include_og_title: z.boolean().optional(),
  include_schema_markup: z.boolean().optional(),
  heading_depth: z.number().int().min(1).max(4).optional(),
  custom_sections: z.array(z.string().max(100)).max(10).optional(),
  tone_notes: z.string().max(500).optional(),
  formatting_notes: z.string().max(500).optional(),
})

const BRIEF_DEFAULTS = {
  target_word_count: 1500,
  include_outline: true,
  include_faq: false,
  include_key_takeaways: true,
  include_meta_description: true,
  include_og_title: true,
  include_schema_markup: false,
  heading_depth: 2,
  custom_sections: [],
  tone_notes: null,
  formatting_notes: null,
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
  const stored = ctx.brief_template ?? null

  return NextResponse.json({
    brief_template: stored ? { ...BRIEF_DEFAULTS, ...(stored as object) } : BRIEF_DEFAULTS,
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

  const parsed = briefTemplateBody.safeParse(json)
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

  const prevTemplate =
    prevCtx.brief_template && typeof prevCtx.brief_template === 'object'
      ? (prevCtx.brief_template as Record<string, unknown>)
      : {}

  const updated = { ...BRIEF_DEFAULTS, ...prevTemplate, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, brief_template: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ brief_template: updated }, { status: 200 })
}
