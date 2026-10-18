// QA summary analytics — aggregate QA scores and failure rates across articles
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const cluster = searchParams.get('cluster')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, slug, status, cluster_name, qa_score, readability_score, word_count')
    .eq('app_id', appId)
    .not('status', 'eq', 'archived')

  if (cluster) query = query.eq('cluster_name', cluster)

  const { data: articles, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = articles ?? []
  const withQa = rows.filter((a) => a.qa_score !== null)
  const qaScores = withQa.map((a) => a.qa_score as number)
  const avgQa = qaScores.length > 0 ? Math.round(qaScores.reduce((s, v) => s + v, 0) / qaScores.length) : null

  const readabilityScores = rows.filter((a) => a.readability_score !== null).map((a) => a.readability_score as number)
  const avgReadability = readabilityScores.length > 0
    ? Math.round(readabilityScores.reduce((s, v) => s + v, 0) / readabilityScores.length)
    : null

  const SCORE_BUCKETS = [
    { label: 'excellent', min: 90, max: 100 },
    { label: 'good', min: 70, max: 89 },
    { label: 'fair', min: 50, max: 69 },
    { label: 'poor', min: 0, max: 49 },
  ]

  const scoreDistribution = SCORE_BUCKETS.map((b) => ({
    grade: b.label,
    count: qaScores.filter((s) => s >= b.min && s <= b.max).length,
  }))

  const lowScoreArticles = withQa
    .filter((a) => (a.qa_score as number) < 50)
    .sort((a, b) => (a.qa_score as number) - (b.qa_score as number))
    .slice(0, 10)
    .map((a) => ({ article_id: a.id, slug: a.slug, qa_score: a.qa_score, cluster_name: a.cluster_name ?? null }))

  return NextResponse.json({
    cluster_filter: cluster ?? null,
    total_articles: rows.length,
    articles_with_qa: withQa.length,
    avg_qa_score: avgQa,
    avg_readability_score: avgReadability,
    score_distribution: scoreDistribution,
    lowest_scoring_articles: lowScoreArticles,
  })
}
