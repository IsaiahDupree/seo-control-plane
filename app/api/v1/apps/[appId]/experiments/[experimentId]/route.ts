import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchExperimentBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; experimentId: string }> }

const experimentColumns =
  'id, article_id, variant_type, control_value, variant_value, status, winner, started_at, concluded_at, control_conversions, variant_conversions, control_sessions, variant_sessions, significance_pct, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, experimentId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_experiments')
    .select(experimentColumns)
    .eq('id', experimentId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Experiment not found')

  return NextResponse.json({ experiment: data })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, experimentId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchExperimentBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: existing, error: exErr } = await admin
    .from('scp_experiments')
    .select(
      'id, article_id, status, winner, concluded_at, significance_pct, control_conversions, variant_conversions, control_sessions, variant_sessions'
    )
    .eq('id', experimentId)
    .eq('app_id', appId)
    .maybeSingle()

  if (exErr) return jsonError(500, 'query_failed', exErr.message)
  if (!existing) return jsonError(404, 'not_found', 'Experiment not found')

  const patch: Record<string, unknown> = {}
  const p = parsed.data
  if (p.status !== undefined) patch.status = p.status
  if (p.winner !== undefined) patch.winner = p.winner
  if (p.concluded_at !== undefined) patch.concluded_at = p.concluded_at
  if (p.significance_pct !== undefined) patch.significance_pct = p.significance_pct
  if (p.control_conversions !== undefined) patch.control_conversions = p.control_conversions
  if (p.variant_conversions !== undefined) patch.variant_conversions = p.variant_conversions
  if (p.control_sessions !== undefined) patch.control_sessions = p.control_sessions
  if (p.variant_sessions !== undefined) patch.variant_sessions = p.variant_sessions

  const { data, error } = await admin
    .from('scp_experiments')
    .update(patch)
    .eq('id', experimentId)
    .eq('app_id', appId)
    .select(experimentColumns)
    .single()

  if (error) return jsonError(500, 'update_failed', error.message)

  const before: Record<string, unknown> = {}
  const pk = parsed.data
  if (pk.status !== undefined) before.status = existing.status
  if (pk.winner !== undefined) before.winner = existing.winner
  if (pk.concluded_at !== undefined) before.concluded_at = existing.concluded_at
  if (pk.significance_pct !== undefined) before.significance_pct = existing.significance_pct
  if (pk.control_conversions !== undefined)
    before.control_conversions = existing.control_conversions
  if (pk.variant_conversions !== undefined)
    before.variant_conversions = existing.variant_conversions
  if (pk.control_sessions !== undefined) before.control_sessions = existing.control_sessions
  if (pk.variant_sessions !== undefined) before.variant_sessions = existing.variant_sessions

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'experiment.patch',
    entity_type: 'experiment',
    entity_id: experimentId,
    performed_by: null,
    payload: {
      source: 'api_key',
      article_id: existing.article_id,
      before,
      changes: parsed.data,
    },
  })

  return NextResponse.json({
    experiment: data,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
