// F-CP-031: Article metadata defaults configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const articleDefaultsBody = z.object({
  default_content_type: z.enum(['article', 'how_to', 'listicle', 'comparison', 'case_study', 'tutorial']).optional(),
  default_word_count: z.number().int().min(300).max(10000).optional(),
  default_reading_level: z.enum(['basic', 'intermediate', 'advanced', 'expert']).optional(),
  default_tone: z.string().max(100).optional(),
  include_table_of_contents: z.boolean().optional(),
  include_faq_section: z.boolean().optional(),
  include_key_takeaways: z.boolean().optional(),
  cta_placement: z.enum(['intro', 'end', 'both', 'none']).optional(),
  default_author: z.string().max(200).optional(),
  og_image_strategy: z.enum(['auto_generate', 'use_default', 'none']).optional(),
  default_og_image_url: z.string().url().optional().nullable(),
})

const ARTICLE_DEFAULTS = {
  default_content_type: 'article',
  default_word_count: 1500,
  default_reading_level: 'intermediate',
  default_tone: 'professional',
  include_table_of_contents: true,
  include_faq_section: false,
  include_key_takeaways: true,
  cta_placement: 'end',
  default_author: null,
  og_image_strategy: 'none',
  default_og_image_url: null,
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
  const stored = ctx.article_defaults ?? null

  return NextResponse.json({
    article_defaults: stored ? { ...ARTICLE_DEFAULTS, ...(stored as object) } : ARTICLE_DEFAULTS,
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

  const parsed = articleDefaultsBody.safeParse(json)
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

  const prevDefaults =
    prevCtx.article_defaults && typeof prevCtx.article_defaults === 'object'
      ? (prevCtx.article_defaults as Record<string, unknown>)
      : {}

  const updated = { ...ARTICLE_DEFAULTS, ...prevDefaults, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, article_defaults: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'article_defaults',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ article_defaults: updated }, { status: 200 })
}
