// F-CP-065: App webhook event types configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const ALL_EVENT_TYPES = [
  'article.created',
  'article.updated',
  'article.published',
  'article.approved',
  'article.rejected',
  'article.indexed',
  'brief.created',
  'brief.generated',
  'brief.rejected',
  'keyword.opportunity_scored',
  'keyword.rank_changed',
  'delivery.succeeded',
  'delivery.failed',
  'app.context_synced',
  'app.deactivated',
  'app.reactivated',
  'quota.exhausted',
  'quota.reset',
]

const eventTypesBody = z.object({
  enabled_events: z.array(z.string()).max(ALL_EVENT_TYPES.length),
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
  const enabledEvents = (ctx.webhook_event_types as string[] | null) ?? ALL_EVENT_TYPES

  return NextResponse.json({
    enabled_events: enabledEvents,
    available_events: ALL_EVENT_TYPES,
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

  const parsed = eventTypesBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  // Validate all supplied events are known
  const unknown = parsed.data.enabled_events.filter((e) => !ALL_EVENT_TYPES.includes(e))
  if (unknown.length > 0) {
    return jsonError(400, 'unknown_events', `Unknown event types: ${unknown.join(', ')}`)
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

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, webhook_event_types: parsed.data.enabled_events }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ enabled_events: parsed.data.enabled_events }, { status: 200 })
}
