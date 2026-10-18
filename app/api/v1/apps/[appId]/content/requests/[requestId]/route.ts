import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchContentRequestBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; requestId: string }> }

const requestColumns = 'id, app_id, requested_count, status, notes, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, requestId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: reqRow, error: reqErr } = await admin
    .from('scp_content_requests')
    .select(requestColumns)
    .eq('id', requestId)
    .eq('app_id', appId)
    .maybeSingle()

  if (reqErr) return jsonError(500, 'query_failed', reqErr.message)
  if (!reqRow) return jsonError(404, 'not_found', 'Content request not found')

  const { count: briefs_total, error: tErr } = await admin
    .from('scp_content_briefs')
    .select('*', { count: 'exact', head: true })
    .eq('content_request_id', requestId)

  if (tErr) return jsonError(500, 'query_failed', tErr.message)

  const statuses = ['pending', 'generating', 'complete'] as const
  const countResults = await Promise.all(
    statuses.map((s) =>
      admin
        .from('scp_content_briefs')
        .select('*', { count: 'exact', head: true })
        .eq('content_request_id', requestId)
        .eq('status', s)
    )
  )
  const briefs_by_status: Record<string, number> = {}
  for (let i = 0; i < statuses.length; i++) {
    const { count, error } = countResults[i]
    if (error) return jsonError(500, 'query_failed', error.message)
    briefs_by_status[statuses[i]] = count ?? 0
  }

  return NextResponse.json({
    request: reqRow,
    briefs: {
      total: briefs_total ?? 0,
      by_status: briefs_by_status,
    },
  })
}

/**
 * - `{ "status": "cancelled" }` — cancel while still **open** (before allocate completes processing).
 * - `{ "notes": "..." }` or `{ "notes": null }` — update notes while **open**.
 * If both are sent, cancellation wins (notes are not applied in the same request).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, requestId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchContentRequestBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  if (parsed.data.status === 'cancelled') {
    const { data: reqRow, error: reqErr } = await admin
      .from('scp_content_requests')
      .select('id, status')
      .eq('id', requestId)
      .eq('app_id', appId)
      .maybeSingle()

    if (reqErr) return jsonError(500, 'query_failed', reqErr.message)
    if (!reqRow) return jsonError(404, 'not_found', 'Content request not found')

    if (reqRow.status !== 'open') {
      return jsonError(
        409,
        'not_cancellable',
        `Only open requests can be cancelled (current status: ${reqRow.status})`
      )
    }

    const { data: updated, error: updErr } = await admin
      .from('scp_content_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('app_id', appId)
      .select(requestColumns)
      .single()

    if (updErr || !updated) {
      return jsonError(500, 'update_failed', updErr?.message ?? 'Failed to cancel')
    }

    const audit_warning = await tryInsertUserAudit(admin, {
      app_id: appId,
      action: 'content_request.cancelled',
      entity_type: 'content_request',
      entity_id: requestId,
      performed_by: null,
      payload: { source: 'api_key' },
    })

    return NextResponse.json({
      request: updated,
      ...(audit_warning ? { audit_warning } : {}),
    })
  }

  if (parsed.data.notes === undefined) {
    return jsonError(400, 'validation_error', 'Provide status (cancelled) and/or notes')
  }

  const { data: reqRow, error: reqErr } = await admin
    .from('scp_content_requests')
    .select('id, status, notes')
    .eq('id', requestId)
    .eq('app_id', appId)
    .maybeSingle()

  if (reqErr) return jsonError(500, 'query_failed', reqErr.message)
  if (!reqRow) return jsonError(404, 'not_found', 'Content request not found')

  if (reqRow.status !== 'open') {
    return jsonError(
      409,
      'not_editable',
      `Only open requests can be edited (current status: ${reqRow.status})`
    )
  }

  const beforeNotes = reqRow.notes
  const { data: updated, error: updErr } = await admin
    .from('scp_content_requests')
    .update({ notes: parsed.data.notes })
    .eq('id', requestId)
    .eq('app_id', appId)
    .select(requestColumns)
    .single()

  if (updErr || !updated) {
    return jsonError(500, 'update_failed', updErr?.message ?? 'Failed to update notes')
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'content_request.notes_updated',
    entity_type: 'content_request',
    entity_id: requestId,
    performed_by: null,
    payload: {
      source: 'api_key',
      before: { notes: beforeNotes },
      after: { notes: parsed.data.notes },
    },
  })

  return NextResponse.json({
    request: updated,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
