// Analytics connector configuration — GSC, GA4, PostHog integration settings
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const connectorSchema = z.object({
  gsc: z.object({
    enabled: z.boolean().default(false),
    site_url: z.string().url().optional(),
    service_account_email: z.string().email().optional(),
  }).optional(),
  ga4: z.object({
    enabled: z.boolean().default(false),
    measurement_id: z.string().max(50).optional(),
    property_id: z.string().max(50).optional(),
  }).optional(),
  posthog: z.object({
    enabled: z.boolean().default(false),
    project_api_key: z.string().max(200).optional(),
    host: z.string().url().optional(),
  }).optional(),
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
  const connectors = (ctx.connectors ?? {}) as Record<string, unknown>

  return NextResponse.json({ connectors })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = connectorSchema.safeParse(json)
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

  const prevConnectors = (prevCtx.connectors && typeof prevCtx.connectors === 'object')
    ? (prevCtx.connectors as Record<string, unknown>)
    : {}

  const updatedConnectors = { ...prevConnectors, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, connectors: updatedConnectors }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ connectors: updatedConnectors })
}
