// Request a content refresh for one or more articles
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const refreshBody = z.object({
  article_ids: z.array(z.string().uuid()).min(1).max(50),
  reason: z.string().max(500).default('manual_request'),
  priority_boost: z.number().int().min(0).max(100).default(50),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = refreshBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  // Verify articles belong to app
  const { data: articles, error: artErr } = await admin
    .from('scp_articles')
    .select('id, status')
    .eq('app_id', appId)
    .in('id', parsed.data.article_ids)

  if (artErr) return jsonError(500, 'query_failed', artErr.message)

  const validIds = (articles ?? []).map((a) => a.id as string)
  const invalidIds = parsed.data.article_ids.filter((id) => !validIds.includes(id))

  if (validIds.length === 0) {
    return jsonError(404, 'not_found', 'No articles found for provided IDs')
  }

  const now = new Date().toISOString()

  // Upsert into refresh queue
  const rows = validIds.map((articleId) => ({
    app_id: appId,
    article_id: articleId,
    reason: parsed.data.reason,
    priority_score: parsed.data.priority_boost,
    status: 'queued',
    queued_at: now,
  }))

  const { error: qErr } = await admin
    .from('scp_refresh_queue')
    .upsert(rows, { onConflict: 'article_id' })

  if (qErr) return jsonError(500, 'queue_failed', qErr.message)

  return NextResponse.json({
    queued: validIds.length,
    invalid_ids: invalidIds,
    queued_article_ids: validIds,
    queued_at: now,
  }, { status: 202 })
}
