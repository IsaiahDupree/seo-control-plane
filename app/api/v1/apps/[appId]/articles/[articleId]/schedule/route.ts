// Schedule an article for future publish or update its scheduled time
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const scheduleBody = z.object({
  scheduled_publish_at: z.string().datetime(),
  cancel: z.boolean().default(false),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, status, scheduled_publish_at')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    status: article.status,
    scheduled_publish_at: article.scheduled_publish_at ?? null,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = scheduleBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (parsed.data.cancel) {
    const { error } = await admin
      .from('scp_articles')
      .update({ scheduled_publish_at: null, updated_at: now })
      .eq('id', articleId)
      .eq('app_id', appId)

    if (error) return jsonError(500, 'update_failed', error.message)
    return NextResponse.json({ article_id: articleId, scheduled_publish_at: null, cancelled: true })
  }

  const scheduledAt = new Date(parsed.data.scheduled_publish_at)
  if (scheduledAt <= new Date()) {
    return jsonError(400, 'invalid_date', 'scheduled_publish_at must be in the future')
  }

  const { error } = await admin
    .from('scp_articles')
    .update({ scheduled_publish_at: parsed.data.scheduled_publish_at, status: 'scheduled', updated_at: now })
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  // Upsert into publish queue
  await admin
    .from('scp_publish_queue')
    .upsert({
      app_id: appId,
      article_id: articleId,
      scheduled_for: parsed.data.scheduled_publish_at,
      status: 'pending',
    }, { onConflict: 'article_id' })

  return NextResponse.json({
    article_id: articleId,
    scheduled_publish_at: parsed.data.scheduled_publish_at,
    status: 'scheduled',
  })
}
