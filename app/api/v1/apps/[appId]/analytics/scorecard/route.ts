// Content performance scorecard — holistic per-app SEO health score
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const [articlesResult, kwResult, linksResult, queueResult] = await Promise.all([
    admin
      .from('scp_articles')
      .select('id, status, gsc_avg_position, gsc_clicks, gsc_impressions, word_count, qa_score, published_at, focus_keyword')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived'),
    admin
      .from('scp_keywords')
      .select('id, status, opportunity_score')
      .eq('app_id', appId),
    admin
      .from('scp_internal_link_edges')
      .select('id')
      .eq('app_id', appId),
    admin
      .from('scp_refresh_queue')
      .select('id, status')
      .eq('app_id', appId)
      .eq('status', 'queued'),
  ])

  if (articlesResult.error) return jsonError(500, 'query_failed', articlesResult.error.message)

  const articles = articlesResult.data ?? []
  const keywords = kwResult.data ?? []
  const links = linksResult.data ?? []

  const published = articles.filter((a) => ['published', 'indexed', 'ranked'].includes(a.status as string))
  const ranked = articles.filter((a) => {
    const pos = a.gsc_avg_position as number | null
    return pos !== null && pos <= 20
  })
  const withKeyword = articles.filter((a) => a.focus_keyword)
  const withQaScore = articles.filter((a) => (a.qa_score as number | null) !== null)
  const avgQa = withQaScore.length > 0
    ? Math.round(withQaScore.reduce((s, a) => s + (a.qa_score as number), 0) / withQaScore.length)
    : null

  const activeKw = keywords.filter((k) => k.status === 'active')

  // Scoring dimensions (each 0-100, weighted)
  const contentScore = articles.length > 0
    ? Math.min(100, Math.round((published.length / articles.length) * 100))
    : 0
  const rankingScore = published.length > 0
    ? Math.min(100, Math.round((ranked.length / published.length) * 100))
    : 0
  const keywordCoverageScore = articles.length > 0
    ? Math.min(100, Math.round((withKeyword.length / articles.length) * 100))
    : 0
  const qualityScore = avgQa ?? 0
  const linkScore = published.length > 0
    ? Math.min(100, Math.round((links.length / Math.max(published.length, 1)) * 20))
    : 0

  const overallScore = Math.round(
    contentScore * 0.25 +
    rankingScore * 0.30 +
    keywordCoverageScore * 0.15 +
    qualityScore * 0.20 +
    linkScore * 0.10
  )

  const totalClicks = published.reduce((s, a) => s + ((a.gsc_clicks as number) ?? 0), 0)
  const totalImpressions = published.reduce((s, a) => s + ((a.gsc_impressions as number) ?? 0), 0)
  const positions = published.map((a) => a.gsc_avg_position as number | null).filter((p): p is number => p !== null)
  const avgPosition = positions.length > 0 ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null

  return NextResponse.json({
    overall_score: overallScore,
    grade: overallScore >= 80 ? 'A' : overallScore >= 65 ? 'B' : overallScore >= 50 ? 'C' : overallScore >= 35 ? 'D' : 'F',
    dimensions: {
      content_published_pct: contentScore,
      ranking_in_top20_pct: rankingScore,
      keyword_coverage_pct: keywordCoverageScore,
      avg_qa_score: qualityScore,
      internal_link_density: linkScore,
    },
    snapshot: {
      total_articles: articles.length,
      published_articles: published.length,
      ranked_articles: ranked.length,
      active_keywords: activeKw.length,
      total_internal_links: links.length,
      refresh_queue_depth: queueResult.data?.length ?? 0,
      total_gsc_clicks: totalClicks,
      total_gsc_impressions: totalImpressions,
      avg_gsc_position: avgPosition,
    },
    scored_at: new Date().toISOString(),
  })
}
