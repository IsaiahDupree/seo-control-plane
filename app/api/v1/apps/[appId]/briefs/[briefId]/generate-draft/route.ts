// Trigger draft generation from an approved brief
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; briefId: string }> }

const generateBody = z.object({
  model: z.string().max(100).optional(),
  provider: z.enum(['openai', 'anthropic', 'google']).optional(),
  force: z.boolean().default(false),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, briefId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { json = {} }

  const parsed = generateBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const { data: brief, error: briefErr } = await admin
    .from('scp_content_briefs')
    .select('id, status, article_id, content_request_id')
    .eq('id', briefId)
    .eq('app_id', appId)
    .maybeSingle()

  if (briefErr) return jsonError(500, 'query_failed', briefErr.message)
  if (!brief) return jsonError(404, 'not_found', 'Brief not found')

  if (!parsed.data.force && !['approved', 'ready'].includes(brief.status as string)) {
    return jsonError(409, 'invalid_status', `Brief status '${brief.status}' is not eligible for generation. Use force=true to override.`)
  }

  const { data: job, error: jobErr } = await admin
    .from('scp_generation_jobs')
    .insert({
      app_id: appId,
      article_id: brief.article_id ?? null,
      brief_id: briefId,
      status: 'pending',
      llm_provider: parsed.data.provider ?? null,
      llm_model: parsed.data.model ?? null,
    })
    .select('id')
    .single()

  if (jobErr) return jsonError(500, 'job_create_failed', jobErr.message)

  // Update brief status
  await admin
    .from('scp_content_briefs')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', briefId)

  return NextResponse.json({
    brief_id: briefId,
    generation_job_id: job.id,
    status: 'pending',
    message: 'Generation job enqueued',
  }, { status: 202 })
}
