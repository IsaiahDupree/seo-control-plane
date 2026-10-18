// F-CP-051: Topical authority score endpoint
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

  const [articlesResult, keywordsResult, pillarsResult] = await Promise.all([
    admin
      .from('scp_articles')
      .select('id, cluster_name, status, gsc_avg_position, gsc_clicks, focus_keyword')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked']),
    admin
      .from('scp_keywords')
      .select('keyword, cluster_name, status, search_volume, opportunity_score, intent_type')
      .eq('app_id', appId)
      .eq('status', 'active'),
    admin
      .from('scp_content_pillars')
      .select('id, name, slug, parent_slug')
      .eq('app_id', appId),
  ])

  if (articlesResult.error) return jsonError(500, 'query_failed', articlesResult.error.message)

  const articles = articlesResult.data ?? []
  const keywords = keywordsResult.data ?? []
  const pillars = pillarsResult.data ?? []

  // Compute per-cluster authority scores
  const clusterMap = new Map<string, {
    article_count: number
    avg_position: number | null
    total_clicks: number
    keyword_count: number
    total_search_volume: number
    covered_keywords: number
  }>()

  for (const a of articles) {
    const cluster = (a.cluster_name as string | null) ?? 'Unclustered'
    if (!clusterMap.has(cluster)) {
      clusterMap.set(cluster, { article_count: 0, avg_position: null, total_clicks: 0, keyword_count: 0, total_search_volume: 0, covered_keywords: 0 })
    }
    const c = clusterMap.get(cluster)!
    c.article_count++
    c.total_clicks += (a.gsc_clicks as number | null) ?? 0
    if (a.gsc_avg_position !== null) {
      c.avg_position = c.avg_position === null ? (a.gsc_avg_position as number) : (c.avg_position + (a.gsc_avg_position as number)) / 2
    }
    if (a.focus_keyword) c.covered_keywords++
  }

  for (const k of keywords) {
    const cluster = (k.cluster_name as string | null) ?? 'Unclustered'
    if (!clusterMap.has(cluster)) {
      clusterMap.set(cluster, { article_count: 0, avg_position: null, total_clicks: 0, keyword_count: 0, total_search_volume: 0, covered_keywords: 0 })
    }
    const c = clusterMap.get(cluster)!
    c.keyword_count++
    c.total_search_volume += (k.search_volume as number | null) ?? 0
  }

  // Score each cluster (0-100)
  const clusterScores = Array.from(clusterMap.entries()).map(([name, data]) => {
    const coverageScore = data.keyword_count > 0
      ? Math.min(40, Math.round((data.covered_keywords / data.keyword_count) * 40))
      : 0
    const positionScore = data.avg_position !== null
      ? Math.max(0, 30 - Math.round(data.avg_position * 2))
      : 0
    const depthScore = Math.min(20, data.article_count * 4)
    const trafficScore = Math.min(10, Math.round(Math.log10(data.total_clicks + 1) * 3))

    const total = coverageScore + positionScore + depthScore + trafficScore

    return {
      cluster_name: name,
      authority_score: Math.min(100, total),
      article_count: data.article_count,
      keyword_count: data.keyword_count,
      covered_keywords: data.covered_keywords,
      avg_position: data.avg_position !== null ? Math.round(data.avg_position * 10) / 10 : null,
      total_clicks: data.total_clicks,
      total_search_volume: data.total_search_volume,
      breakdown: { coverage_score: coverageScore, position_score: positionScore, depth_score: depthScore, traffic_score: trafficScore },
    }
  }).sort((a, b) => b.authority_score - a.authority_score)

  const overallScore = clusterScores.length > 0
    ? Math.round(clusterScores.reduce((s, c) => s + c.authority_score, 0) / clusterScores.length)
    : 0

  return NextResponse.json({
    overall_authority_score: overallScore,
    cluster_count: clusterScores.length,
    pillar_count: pillars.length,
    total_articles: articles.length,
    total_active_keywords: keywords.length,
    clusters: clusterScores,
    scored_at: new Date().toISOString(),
  })
}
