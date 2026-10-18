import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { runProcessPendingBriefsBatch } from '@/lib/process-pending-briefs'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const contentTypeEnum = z.enum([
  'pillar',
  'cluster',
  'comparison',
  'alternatives',
  'faq',
  'guide',
  'case_study',
])

const bodySchema = z.object({
  limit: z.number().int().min(1).max(3).optional(),
  target_word_count: z.number().int().min(300).max(8000).optional(),
  target_persona: z.string().max(200).optional(),
  tone_notes: z.string().max(500).optional(),
  cta_guidance: z.string().max(500).optional(),
  content_type: contentTypeEnum.optional(),
  auto_deliver: z.boolean().optional(),
})

/**
 * Worker-friendly: generate articles for the oldest pending briefs in one request.
 * Prefer `limit: 1` from cron; use up to 3 only if your runtime budget allows.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown = {}
  try {
    const text = await request.text()
    if (text) json = JSON.parse(text)
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const lim = parsed.data.limit ?? 1
  const {
    target_word_count,
    target_persona,
    tone_notes,
    cta_guidance,
    content_type,
    auto_deliver,
  } = parsed.data

  const overrides = {
    ...(target_word_count !== undefined ? { target_word_count } : {}),
    ...(target_persona !== undefined ? { target_persona } : {}),
    ...(tone_notes !== undefined ? { tone_notes } : {}),
    ...(cta_guidance !== undefined ? { cta_guidance } : {}),
    ...(content_type !== undefined ? { content_type } : {}),
    ...(auto_deliver !== undefined ? { auto_deliver } : {}),
  }

  const result = await runProcessPendingBriefsBatch(appId, lim, overrides)

  if (result.kind === 'query_failed') {
    return jsonError(500, 'query_failed', result.message)
  }
  if (result.kind === 'app_not_found') {
    return jsonError(404, 'app_not_found', 'App not found')
  }
  if (result.kind === 'monthly_limit') {
    return jsonError(429, 'monthly_limit_exceeded', 'Monthly article limit reached', {
      used: result.used,
      limit: result.limit,
      partial: result.partial,
    })
  }
  if (result.kind === 'empty') {
    return NextResponse.json({ processed: [], message: 'No pending briefs' })
  }

  const admin = createAdminClient()
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'briefs.process_pending',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      limit_requested: lim,
      processed: result.processed,
      failures: result.failures,
    },
  })

  return NextResponse.json({
    processed: result.processed,
    failures: result.failures,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
