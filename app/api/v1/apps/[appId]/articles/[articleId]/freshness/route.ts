// F-CP-057: Article freshness/decay scoring + refresh trigger
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function freshnessScore(publishedAt: string | null, updatedAt: string, gscPosition: number | null): number {
  const now = Date.now()
  const publishDate = new Date(publishedAt ?? updatedAt).getTime()
  const ageDays = (now - publishDate) / (1000 * 60 * 60 * 24)

  // Decay curve: starts at 100, decays significantly after 6 months
  let score = 100

  if (ageDays > 365) score -= 50
  else if (ageDays > 180) score -= 30
  else if (ageDays > 90) score -= 15
  else if (ageDays > 30) score -= 5

  // Ranking penalty: positions dropping toward 20+ signals staleness
  if (gscPosition !== null) {
    if (gscPosition > 15) score -= 20
    else if (gscPosition > 10) score -= 10
    else if (gscPosition > 5) score -= 5
  }

  return Math.max(0, Math.round(score))
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, published_at, updated_at, gsc_avg_position, focus_keyword')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const publishedAt = article.published_at as string | null
  const updatedAt = article.updated_at as string
  const gscPosition = article.gsc_avg_position as number | null

  const now = Date.now()
  const publishDate = new Date(publishedAt ?? updatedAt).getTime()
  const ageDays = Math.round((now - publishDate) / (1000 * 60 * 60 * 24))
  const score = freshnessScore(publishedAt, updatedAt, gscPosition)

  const needsRefresh = score < 60
  const urgency = score < 30 ? 'high' : score < 60 ? 'medium' : 'low'

  const recommendations: string[] = []
  if (ageDays > 180) recommendations.push('Content is 6+ months old — review statistics and examples')
  if (ageDays > 365) recommendations.push('Content is 1+ year old — full refresh recommended')
  if (gscPosition !== null && gscPosition > 15) recommendations.push('Ranking has dropped below position 15 — update to regain visibility')
  if (score < 50) recommendations.push('Add recent data, updated examples, or new sections')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    freshness: {
      score,
      needs_refresh: needsRefresh,
      urgency,
      age_days: ageDays,
      published_at: publishedAt,
      last_updated_at: updatedAt,
      gsc_avg_position: gscPosition,
    },
    recommendations,
    scored_at: new Date().toISOString(),
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, focus_keyword, status')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  // Add to refresh queue
  const { data: existing } = await admin
    .from('scp_refresh_queue')
    .select('id, status')
    .eq('article_id', articleId)
    .eq('status', 'queued')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ queued: false, message: 'Already in refresh queue', queue_id: existing.id })
  }

  const now = new Date().toISOString()
  const { data: queued, error: qErr } = await admin
    .from('scp_refresh_queue')
    .insert({
      app_id: appId,
      article_id: articleId,
      status: 'queued',
      priority_score: 100,
      reason: 'manual_freshness_trigger',
      created_at: now,
    })
    .select('id')
    .single()

  if (qErr) return jsonError(500, 'queue_failed', qErr.message)

  return NextResponse.json({ queued: true, queue_id: queued.id, article_id: articleId }, { status: 201 })
}
