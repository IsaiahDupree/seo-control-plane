// Article content feedback (reader feedback ingestion and retrieval)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  comment: z.string().max(2000).optional(),
  feedback_type: z.enum(['accuracy', 'helpfulness', 'readability', 'relevance', 'other']).default('other'),
  source: z.string().max(100).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: events, error } = await admin
    .from('scp_analytics_events')
    .select('event_name, payload, occurred_at')
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .eq('event_name', 'article_feedback')
    .order('occurred_at', { ascending: false })
    .limit(200)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = events ?? []
  const ratings = rows.map((e) => ((e.payload as Record<string, unknown>).rating as number | null)).filter((r): r is number => typeof r === 'number')
  const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null

  const sentimentCounts = rows.reduce((acc: Record<string, number>, e) => {
    const s = ((e.payload as Record<string, unknown>).sentiment as string | null) ?? 'unknown'
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    article_id: articleId,
    total_feedback: rows.length,
    avg_rating: avgRating,
    sentiment_counts: sentimentCounts,
    recent: rows.slice(0, 20).map((e) => ({ payload: e.payload, occurred_at: e.occurred_at })),
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = feedbackSchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const { error } = await admin.from('scp_analytics_events').insert({
    app_id: appId,
    article_id: articleId,
    event_name: 'article_feedback',
    payload: parsed.data,
  })

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ received: true }, { status: 201 })
}
