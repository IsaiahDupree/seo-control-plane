// Allowed content types configuration — which article formats are enabled per app
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const CONTENT_TYPES = [
  'comparison', 'alternatives', 'best_for', 'use_case', 'workflow', 'industry',
  'persona', 'feature', 'problem_solution', 'template', 'faq', 'implementation_guide',
  'migration_guide', 'pricing_explainer', 'integration', 'case_study', 'glossary',
  'long_tail', 'refresh', 'pillar', 'cluster',
] as const

const contentTypesBody = z.object({
  enabled: z.array(z.enum(CONTENT_TYPES)).min(1),
  default_type: z.enum(CONTENT_TYPES).optional(),
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
  const contentTypeConfig = (ctx.content_types ?? {
    enabled: ['comparison', 'alternatives', 'use_case', 'faq', 'pillar', 'cluster', 'refresh'],
    default_type: 'cluster',
  }) as Record<string, unknown>

  return NextResponse.json({
    available: CONTENT_TYPES,
    config: contentTypeConfig,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = contentTypesBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx = (app.context && typeof app.context === 'object' && !Array.isArray(app.context))
    ? (app.context as Record<string, unknown>)
    : {}

  const { error } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, content_types: parsed.data }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ config: parsed.data })
}
