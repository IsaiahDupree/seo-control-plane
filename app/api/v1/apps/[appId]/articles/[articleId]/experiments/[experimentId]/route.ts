import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { evaluateExperiment, concludeExperiment } from '@/lib/experiments'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string; experimentId: string }> }

/** GET — single experiment with live stats */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId, experimentId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const db = createAdminClient()
  const { data, error } = await db
    .from('scp_experiments')
    .select('*')
    .eq('id', experimentId)
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .single()

  if (error || !data) return jsonError(404, 'not_found', 'Experiment not found')

  return NextResponse.json({
    experiment: {
      ...data,
      stats: evaluateExperiment({
        control_conversions: data.control_conversions as number,
        variant_conversions: data.variant_conversions as number,
        control_sessions: data.control_sessions as number,
        variant_sessions: data.variant_sessions as number,
      }),
    },
  })
}

const patchSchema = z.object({
  action: z.enum(['pause', 'resume', 'conclude', 'cancel']).optional(),
  apply_winner: z.boolean().optional(),
  control_conversions: z.number().int().min(0).optional(),
  variant_conversions: z.number().int().min(0).optional(),
  control_sessions: z.number().int().min(0).optional(),
  variant_sessions: z.number().int().min(0).optional(),
})

/** PATCH — update stats, pause/resume/cancel, or conclude */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, articleId, experimentId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchSchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const { action, apply_winner, ...counters } = parsed.data

  // Handle conclude separately (uses lib helper)
  if (action === 'conclude') {
    const result = await concludeExperiment(experimentId, appId, apply_winner ?? false)
    if (!result.ok) return jsonError(400, 'conclude_failed', result.error ?? 'Failed to conclude')
    const admin = createAdminClient()
    const audit_warning = await tryInsertUserAudit(admin, {
      app_id: appId,
      action: 'experiment.concluded',
      entity_type: 'experiment',
      entity_id: experimentId,
      performed_by: null,
      payload: {
        source: 'api_key',
        article_id: articleId,
        apply_winner: apply_winner ?? false,
        winner: result.winner,
      },
    })
    return NextResponse.json({
      ok: true,
      winner: result.winner,
      ...(audit_warning ? { audit_warning } : {}),
    })
  }

  const db = createAdminClient()

  // Verify experiment belongs to this app + article
  const { data: exp } = await db
    .from('scp_experiments')
    .select(
      'id, status, control_conversions, variant_conversions, control_sessions, variant_sessions'
    )
    .eq('id', experimentId)
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .single()

  if (!exp) return jsonError(404, 'not_found', 'Experiment not found')

  const updates: Record<string, unknown> = {}

  if (action === 'pause') updates.status = 'paused'
  if (action === 'resume') updates.status = 'running'
  if (action === 'cancel') updates.status = 'cancelled'

  if (counters.control_conversions != null) updates.control_conversions = counters.control_conversions
  if (counters.variant_conversions != null) updates.variant_conversions = counters.variant_conversions
  if (counters.control_sessions != null) updates.control_sessions = counters.control_sessions
  if (counters.variant_sessions != null) updates.variant_sessions = counters.variant_sessions

  if (Object.keys(updates).length === 0) {
    return jsonError(400, 'no_updates', 'No valid fields to update')
  }

  const { data, error } = await db
    .from('scp_experiments')
    .update(updates)
    .eq('id', experimentId)
    .select('*')
    .single()

  if (error || !data) return jsonError(500, 'update_failed', error?.message ?? 'Update failed')

  const before: Record<string, unknown> = {}
  if (updates.status !== undefined) before.status = exp.status
  if (counters.control_conversions != null)
    before.control_conversions = exp.control_conversions
  if (counters.variant_conversions != null)
    before.variant_conversions = exp.variant_conversions
  if (counters.control_sessions != null) before.control_sessions = exp.control_sessions
  if (counters.variant_sessions != null) before.variant_sessions = exp.variant_sessions

  const audit_warning = await tryInsertUserAudit(db, {
    app_id: appId,
    action: 'experiment.patch',
    entity_type: 'experiment',
    entity_id: experimentId,
    performed_by: null,
    payload: {
      source: 'api_key',
      article_id: articleId,
      before,
      changes: updates,
    },
  })

  return NextResponse.json({
    experiment: {
      ...data,
      stats: evaluateExperiment({
        control_conversions: data.control_conversions as number,
        variant_conversions: data.variant_conversions as number,
        control_sessions: data.control_sessions as number,
        variant_sessions: data.variant_sessions as number,
      }),
    },
    ...(audit_warning ? { audit_warning } : {}),
  })
}
