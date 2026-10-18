// F-CP-024: Content request priority boost
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; requestId: string }> }

const prioritizeBody = z.object({
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  reason: z.string().max(300).optional(),
})

const PRIORITY_SCORE: Record<string, number> = {
  low: 10,
  normal: 50,
  high: 80,
  urgent: 100,
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, requestId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = prioritizeBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: contentRequest, error: fetchErr } = await admin
    .from('scp_content_requests')
    .select('id, status, priority')
    .eq('id', requestId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!contentRequest) return jsonError(404, 'not_found', 'Content request not found')

  if (['completed', 'cancelled'].includes(contentRequest.status as string)) {
    return jsonError(409, 'terminal_status', `Cannot reprioritize a ${contentRequest.status} request`)
  }

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('scp_content_requests')
    .update({
      priority: parsed.data.priority,
      priority_score: PRIORITY_SCORE[parsed.data.priority],
      updated_at: now,
    })
    .eq('id', requestId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({
    request_id: requestId,
    previous_priority: contentRequest.priority,
    new_priority: parsed.data.priority,
    priority_score: PRIORITY_SCORE[parsed.data.priority],
    reason: parsed.data.reason ?? null,
    updated_at: now,
  })
}
