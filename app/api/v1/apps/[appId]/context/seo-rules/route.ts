// SEO rules configuration — custom SEO rules and guidelines for content generation
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const seoRulesBody = z.object({
  title_rules: z.object({
    min_length: z.number().int().min(10).max(100).optional(),
    max_length: z.number().int().min(30).max(120).optional(),
    require_keyword: z.boolean().optional(),
    preferred_patterns: z.array(z.string().max(200)).max(20).optional(),
  }).optional(),
  meta_description_rules: z.object({
    min_length: z.number().int().min(50).max(200).optional(),
    max_length: z.number().int().min(100).max(320).optional(),
    require_cta: z.boolean().optional(),
  }).optional(),
  heading_rules: z.object({
    max_h2_count: z.number().int().min(1).max(20).optional(),
    require_keyword_in_h2: z.boolean().optional(),
    avoid_consecutive_headings: z.boolean().optional(),
  }).optional(),
  link_rules: z.object({
    min_internal_links: z.number().int().min(0).max(50).optional(),
    max_internal_links: z.number().int().min(1).max(100).optional(),
    require_pillar_link: z.boolean().optional(),
  }).optional(),
  custom_rules: z.array(z.string().max(500)).max(30).optional(),
})

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
  const seoRules = (ctx.seo_rules ?? {}) as Record<string, unknown>

  return NextResponse.json({ seo_rules: seoRules })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = seoRulesBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx = (app.context && typeof app.context === 'object' && !Array.isArray(app.context))
    ? (app.context as Record<string, unknown>) : {}

  const prevRules = (prevCtx.seo_rules && typeof prevCtx.seo_rules === 'object' && !Array.isArray(prevCtx.seo_rules))
    ? (prevCtx.seo_rules as Record<string, unknown>) : {}

  const merged = { ...prevRules, ...parsed.data }

  const { error } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, seo_rules: merged }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ seo_rules: merged })
}
