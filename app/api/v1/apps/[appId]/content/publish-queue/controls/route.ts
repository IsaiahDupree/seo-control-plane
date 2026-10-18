// F-CP-027: Publish queue drain / pause controls
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const controlBody = z.object({
  action: z.enum(['pause', 'resume', 'drain']),
  reason: z.string().max(300).optional(),
})

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

  const parsed = controlBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (parsed.data.action === 'drain') {
    // Cancel all pending queue entries
    const { data: cancelled, error: cancelErr } = await admin
      .from('scp_publish_queue')
      .update({ status: 'cancelled', updated_at: now })
      .eq('app_id', appId)
      .eq('status', 'pending')
      .select('id')

    if (cancelErr) return jsonError(500, 'drain_failed', cancelErr.message)

    await tryInsertUserAudit(admin, {
      app_id: appId,
      action: 'publish_queue.drained',
      entity_type: 'app',
      entity_id: appId,
      performed_by: null,
      payload: { cancelled_count: cancelled?.length ?? 0, reason: parsed.data.reason ?? null },
    })

    return NextResponse.json({
      action: 'drain',
      cancelled_count: cancelled?.length ?? 0,
      drained_at: now,
    })
  }

  // pause / resume: update app context flag
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

  const queuePaused = parsed.data.action === 'pause'

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({
      context: { ...prevCtx, publish_queue_paused: queuePaused, publish_queue_paused_at: queuePaused ? now : null },
      updated_at: now,
    })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: `publish_queue.${parsed.data.action}d`,
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { reason: parsed.data.reason ?? null },
  })

  return NextResponse.json({
    action: parsed.data.action,
    publish_queue_paused: queuePaused,
    updated_at: now,
  })
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const appResult = await admin.from('scp_apps').select('context').eq('id', appId).maybeSingle()

  if (appResult.error || !appResult.data) return jsonError(404, 'not_found', 'App not found')

  const ctx = (appResult.data.context ?? {}) as Record<string, unknown>
  const paused = !!(ctx.publish_queue_paused)

  const { data: statusCounts } = await admin
    .from('scp_publish_queue')
    .select('status')
    .eq('app_id', appId)

  const counts: Record<string, number> = {}
  for (const row of statusCounts ?? []) {
    const s = row.status as string
    counts[s] = (counts[s] ?? 0) + 1
  }

  return NextResponse.json({
    publish_queue_paused: paused,
    paused_at: paused ? (ctx.publish_queue_paused_at as string | null) : null,
    queue_counts: counts,
  })
}
