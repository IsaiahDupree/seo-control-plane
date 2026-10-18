// Trigger content generation for a specific article (brief → draft)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const generateBody = z.object({
  model: z.string().max(100).optional(),
  provider: z.enum(['openai', 'anthropic', 'google']).optional(),
  override_brief: z.record(z.string(), z.unknown()).optional(),
  force: z.boolean().default(false),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { json = {} }

  const parsed = generateBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, brief_id, focus_keyword, target_word_count')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  if (!parsed.data.force && !['draft', 'brief_ready', 'pending'].includes(article.status as string)) {
    return jsonError(409, 'invalid_status', `Article status '${article.status}' is not eligible for generation. Use force=true to override.`)
  }

  // Create a generation job record
  const { data: job, error: jobErr } = await admin
    .from('scp_generation_jobs')
    .insert({
      app_id: appId,
      article_id: articleId,
      brief_id: article.brief_id ?? null,
      status: 'pending',
      llm_provider: parsed.data.provider ?? null,
      llm_model: parsed.data.model ?? null,
      override_brief: parsed.data.override_brief ?? null,
    })
    .select('id')
    .single()

  if (jobErr) return jsonError(500, 'job_create_failed', jobErr.message)

  // Mark article as generating
  await admin
    .from('scp_articles')
    .update({ status: 'generating', updated_at: new Date().toISOString() })
    .eq('id', articleId)

  return NextResponse.json({
    article_id: articleId,
    generation_job_id: job.id,
    status: 'pending',
    message: 'Generation job enqueued. Poll /generation-jobs/:jobId for status.',
  }, { status: 202 })
}
