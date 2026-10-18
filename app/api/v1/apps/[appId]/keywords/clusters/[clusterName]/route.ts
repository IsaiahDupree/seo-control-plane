// Cluster detail — keywords, articles, and stats for a specific cluster
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; clusterName: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, clusterName } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const decodedCluster = decodeURIComponent(clusterName)
  const admin = createAdminClient()

  const [kwResult, artResult] = await Promise.all([
    admin
      .from('scp_keywords')
      .select('id, keyword, status, search_volume, opportunity_score, intent_type, article_id')
      .eq('app_id', appId)
      .eq('cluster_name', decodedCluster)
      .order('opportunity_score', { ascending: false, nullsFirst: false }),
    admin
      .from('scp_articles')
      .select('id, slug, title, status, published_at, gsc_avg_position, gsc_clicks, word_count')
      .eq('app_id', appId)
      .eq('cluster_name', decodedCluster)
      .not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const keywords = kwResult.data ?? []
  const articles = artResult.data ?? []

  const published = articles.filter((a) => ['published', 'indexed', 'ranked'].includes(a.status as string))
  const totalClicks = published.reduce((s, a) => s + ((a.gsc_clicks as number) ?? 0), 0)
  const positions = published.map((a) => a.gsc_avg_position as number | null).filter((p): p is number => p !== null)
  const avgPosition = positions.length > 0
    ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10
    : null

  const assignedKw = keywords.filter((k) => k.article_id !== null)

  return NextResponse.json({
    cluster_name: decodedCluster,
    stats: {
      total_keywords: keywords.length,
      assigned_keywords: assignedKw.length,
      coverage_pct: keywords.length > 0
        ? Math.round((assignedKw.length / keywords.length) * 100)
        : 0,
      total_articles: articles.length,
      published_articles: published.length,
      total_search_volume: keywords.reduce((s, k) => s + ((k.search_volume as number) ?? 0), 0),
      total_gsc_clicks: totalClicks,
      avg_gsc_position: avgPosition,
    },
    keywords: keywords.map((k) => ({
      id: k.id,
      keyword: k.keyword,
      status: k.status,
      search_volume: k.search_volume,
      opportunity_score: k.opportunity_score,
      intent_type: k.intent_type,
      has_article: k.article_id !== null,
    })),
    articles: articles.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      status: a.status,
      published_at: a.published_at,
      gsc_avg_position: a.gsc_avg_position,
      gsc_clicks: a.gsc_clicks,
      word_count: a.word_count,
    })),
  })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId, clusterName } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const decodedCluster = decodeURIComponent(clusterName)
  const { searchParams } = request.nextUrl
  const reassignTo = searchParams.get('reassign_to')

  const admin = createAdminClient()

  const updatePayload: Record<string, string | null> = { cluster_name: reassignTo ?? null }

  const [kwUpdate, artUpdate] = await Promise.all([
    admin.from('scp_keywords').update(updatePayload).eq('app_id', appId).eq('cluster_name', decodedCluster),
    admin.from('scp_articles').update(updatePayload).eq('app_id', appId).eq('cluster_name', decodedCluster),
  ])

  if (kwUpdate.error) return jsonError(500, 'update_failed', kwUpdate.error.message)
  if (artUpdate.error) return jsonError(500, 'update_failed', artUpdate.error.message)

  return NextResponse.json({
    deleted_cluster: decodedCluster,
    reassigned_to: reassignTo ?? null,
  })
}
