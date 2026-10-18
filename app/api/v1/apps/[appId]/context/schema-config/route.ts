// F-CP-030: Article schema / structured data configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const schemaConfigBody = z.object({
  default_article_type: z
    .enum(['Article', 'BlogPosting', 'TechArticle', 'NewsArticle', 'HowTo', 'FAQPage'])
    .optional(),
  enable_breadcrumb: z.boolean().optional(),
  enable_faq_schema: z.boolean().optional(),
  enable_how_to_schema: z.boolean().optional(),
  organization_name: z.string().max(200).optional(),
  organization_url: z.string().url().optional(),
  organization_logo_url: z.string().url().optional(),
  author_name: z.string().max(200).optional(),
  author_url: z.string().url().optional(),
  social_profiles: z.array(z.string().url()).max(10).optional(),
})

const DEFAULT_SCHEMA_CONFIG = {
  default_article_type: 'Article',
  enable_breadcrumb: true,
  enable_faq_schema: true,
  enable_how_to_schema: false,
  organization_name: null,
  organization_url: null,
  organization_logo_url: null,
  author_name: null,
  author_url: null,
  social_profiles: [],
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
  const stored = ctx.schema_config ?? null

  return NextResponse.json({
    schema_config: stored ? { ...DEFAULT_SCHEMA_CONFIG, ...(stored as object) } : DEFAULT_SCHEMA_CONFIG,
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

  const parsed = schemaConfigBody.safeParse(json)
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

  const prevSchema =
    prevCtx.schema_config && typeof prevCtx.schema_config === 'object'
      ? (prevCtx.schema_config as Record<string, unknown>)
      : {}

  const updated = { ...DEFAULT_SCHEMA_CONFIG, ...prevSchema, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, schema_config: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'schema_config',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ schema_config: updated }, { status: 200 })
}
