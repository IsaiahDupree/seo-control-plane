// F-CP-037: Publish window schedule configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const daySchedule = z.object({
  enabled: z.boolean(),
  start_hour: z.number().int().min(0).max(23).optional(),
  end_hour: z.number().int().min(0).max(23).optional(),
  max_articles: z.number().int().min(0).max(50).optional(),
})

const publishWindowBody = z.object({
  timezone: z.string().max(60).optional(),
  monday: daySchedule.optional(),
  tuesday: daySchedule.optional(),
  wednesday: daySchedule.optional(),
  thursday: daySchedule.optional(),
  friday: daySchedule.optional(),
  saturday: daySchedule.optional(),
  sunday: daySchedule.optional(),
  blackout_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(365).optional(),
  max_per_day: z.number().int().min(0).max(50).optional(),
  min_hours_between: z.number().int().min(0).max(168).optional(),
})

const DEFAULT_DAY = { enabled: true, start_hour: 9, end_hour: 17, max_articles: 3 }

const PUBLISH_WINDOW_DEFAULTS = {
  timezone: 'America/New_York',
  monday: DEFAULT_DAY,
  tuesday: DEFAULT_DAY,
  wednesday: DEFAULT_DAY,
  thursday: DEFAULT_DAY,
  friday: DEFAULT_DAY,
  saturday: { ...DEFAULT_DAY, enabled: false },
  sunday: { ...DEFAULT_DAY, enabled: false },
  blackout_dates: [],
  max_per_day: 3,
  min_hours_between: 4,
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
  const stored = ctx.publish_window ?? null

  return NextResponse.json({
    publish_window: stored ? { ...PUBLISH_WINDOW_DEFAULTS, ...(stored as object) } : PUBLISH_WINDOW_DEFAULTS,
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

  const parsed = publishWindowBody.safeParse(json)
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

  const prevWindow =
    prevCtx.publish_window && typeof prevCtx.publish_window === 'object'
      ? (prevCtx.publish_window as Record<string, unknown>)
      : {}

  const updated = { ...PUBLISH_WINDOW_DEFAULTS, ...prevWindow, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, publish_window: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'publish_window',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ publish_window: updated }, { status: 200 })
}
