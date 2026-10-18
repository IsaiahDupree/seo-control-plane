// F-CP-015: App restore from context snapshot
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const restoreBody = z.object({
  sync_log_id: z.string().uuid().optional(),
  sync_type: z.string().max(80).optional(),
  version: z.number().int().min(1).optional(),
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

  const parsed = restoreBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  if (!parsed.data.sync_log_id && !parsed.data.sync_type) {
    return jsonError(400, 'missing_target', 'Provide sync_log_id or sync_type (+ optional version)')
  }

  const admin = createAdminClient()

  // Fetch the target snapshot
  let snapshotQuery = admin
    .from('scp_app_sync_logs')
    .select('id, sync_type, version, snapshot, created_at')
    .eq('app_id', appId)

  if (parsed.data.sync_log_id) {
    snapshotQuery = snapshotQuery.eq('id', parsed.data.sync_log_id)
  } else {
    snapshotQuery = snapshotQuery.eq('sync_type', parsed.data.sync_type!)
    if (parsed.data.version !== undefined) {
      snapshotQuery = snapshotQuery.eq('version', parsed.data.version)
    } else {
      snapshotQuery = snapshotQuery.order('version', { ascending: false })
    }
  }

  const { data: snapshots, error: snapErr } = await snapshotQuery.limit(1)

  if (snapErr) return jsonError(500, 'query_failed', snapErr.message)
  if (!snapshots?.length) return jsonError(404, 'snapshot_not_found', 'No matching snapshot found')

  const snap = snapshots[0]
  const syncType = snap.sync_type as string
  const snapshot = snap.snapshot as Record<string, unknown>

  // Fetch current app context
  const { data: app, error: appErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (appErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx =
    app.context && typeof app.context === 'object' && !Array.isArray(app.context)
      ? (app.context as Record<string, unknown>)
      : {}

  // Restore the specific sync_type key in context
  const contextKey = syncType.replace(/-/g, '_')
  const now = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, [contextKey]: snapshot }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'restore_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'app.context_restored',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: { sync_log_id: snap.id, sync_type: syncType, version: snap.version, restored_at: now },
  })

  return NextResponse.json({
    restored: true,
    sync_type: syncType,
    version: snap.version,
    snapshot_id: snap.id,
    snapshot_created_at: snap.created_at,
    restored_at: now,
  })
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('scp_app_sync_logs')
    .select('id, sync_type, version, created_at')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ snapshots: data ?? [], count: data?.length ?? 0 })
}
