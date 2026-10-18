// Cluster performance analytics — aggregate GSC and article stats per cluster
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
  const sortBy = searchParams.get('sort_by') ?? 'clicks' // clicks | articles | position | authority
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const admin = createAdminClient()

  const [artResult, kwResult] = await Promise.all([
    admin
      .from('scp_articles')
      .select('cluster_name, status, gsc_clicks, gsc_impressions, gsc_avg_position, word_count')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived')
      .not('cluster_name', 'is', null),
    admin
      .from('scp_keywords')
      .select('cluster_name, status, search_volume, opportunity_score')
      .eq('app_id', appId)
      .not('cluster_name', 'is', null),
  ])

  if (artResult.error) return jsonError(500, 'query_failed', artResult.error.message)

  // Aggregate per cluster
  const clusters = new Map<string, {
    total_articles: number
    published_articles: number
    total_clicks: number
    total_impressions: number
    position_sum: number
    position_count: number
    total_words: number
    active_keywords: number
    total_search_volume: number
  }>()

  for (const a of artResult.data ?? []) {
    const c = a.cluster_name as string
    if (!clusters.has(c)) clusters.set(c, { total_articles: 0, published_articles: 0, total_clicks: 0, total_impressions: 0, position_sum: 0, position_count: 0, total_words: 0, active_keywords: 0, total_search_volume: 0 })
    const entry = clusters.get(c)!
    entry.total_articles++
    if (['published', 'indexed', 'ranked'].includes(a.status as string)) entry.published_articles++
    entry.total_clicks += (a.gsc_clicks as number) ?? 0
    entry.total_impressions += (a.gsc_impressions as number) ?? 0
    if (a.gsc_avg_position !== null) { entry.position_sum += a.gsc_avg_position as number; entry.position_count++ }
    entry.total_words += (a.word_count as number) ?? 0
  }

  for (const k of kwResult.data ?? []) {
    const c = k.cluster_name as string
    if (!clusters.has(c)) clusters.set(c, { total_articles: 0, published_articles: 0, total_clicks: 0, total_impressions: 0, position_sum: 0, position_count: 0, total_words: 0, active_keywords: 0, total_search_volume: 0 })
    const entry = clusters.get(c)!
    if (k.status === 'active') entry.active_keywords++
    entry.total_search_volume += (k.search_volume as number) ?? 0
  }

  let result = Array.from(clusters.entries()).map(([name, d]) => ({
    cluster_name: name,
    total_articles: d.total_articles,
    published_articles: d.published_articles,
    active_keywords: d.active_keywords,
    total_search_volume: d.total_search_volume,
    total_gsc_clicks: d.total_clicks,
    total_gsc_impressions: d.total_impressions,
    avg_position: d.position_count > 0 ? Math.round((d.position_sum / d.position_count) * 10) / 10 : null,
    total_words: d.total_words,
    avg_words_per_article: d.total_articles > 0 ? Math.round(d.total_words / d.total_articles) : 0,
  }))

  if (sortBy === 'articles') result = result.sort((a, b) => b.total_articles - a.total_articles)
  else if (sortBy === 'position') result = result.sort((a, b) => (a.avg_position ?? 999) - (b.avg_position ?? 999))
  else result = result.sort((a, b) => b.total_gsc_clicks - a.total_gsc_clicks)

  return NextResponse.json({
    sort_by: sortBy,
    total_clusters: result.length,
    clusters: result.slice(0, limit),
  })
}
