// Link graph analytics — internal link density and cluster connectivity
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

  const [linksResult, articlesResult] = await Promise.all([
    admin
      .from('scp_internal_link_edges')
      .select('from_article_id, to_article_id, to_slug, anchor_text, is_pillar_link, semantic_score')
      .eq('app_id', appId)
      .limit(10000),
    admin
      .from('scp_articles')
      .select('id, slug, title, cluster_name, status')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked']),
  ])

  if (linksResult.error) return jsonError(500, 'query_failed', linksResult.error.message)

  const links = linksResult.data ?? []
  const articles = articlesResult.data ?? []

  const artMap = new Map(articles.map((a) => [a.id as string, a]))

  // Count in-links and out-links per article
  const inCount = new Map<string, number>()
  const outCount = new Map<string, number>()
  const pillarLinkCount = new Map<string, number>()

  for (const link of links) {
    const from = link.from_article_id as string
    const to = link.to_article_id as string | null

    outCount.set(from, (outCount.get(from) ?? 0) + 1)
    if (to) {
      inCount.set(to, (inCount.get(to) ?? 0) + 1)
      if (link.is_pillar_link) pillarLinkCount.set(to, (pillarLinkCount.get(to) ?? 0) + 1)
    }
  }

  // Per-article link stats
  const articleStats = articles.map((a) => ({
    article_id: a.id,
    slug: a.slug,
    title: a.title,
    cluster_name: (a.cluster_name as string | null) ?? null,
    in_links: inCount.get(a.id as string) ?? 0,
    out_links: outCount.get(a.id as string) ?? 0,
    pillar_in_links: pillarLinkCount.get(a.id as string) ?? 0,
    is_orphan: (inCount.get(a.id as string) ?? 0) === 0,
  })).sort((a, b) => b.in_links - a.in_links)

  // Cluster connectivity
  const clusterMap = new Map<string, { articles: number; internal_links: number; cross_links: number }>()
  for (const a of articles) {
    const c = (a.cluster_name as string | null) ?? 'Unclustered'
    if (!clusterMap.has(c)) clusterMap.set(c, { articles: 0, internal_links: 0, cross_links: 0 })
    clusterMap.get(c)!.articles++
  }

  for (const link of links) {
    const fromArt = artMap.get(link.from_article_id as string)
    const toArt = link.to_article_id ? artMap.get(link.to_article_id as string) : null
    if (!fromArt) continue

    const fromCluster = (fromArt.cluster_name as string | null) ?? 'Unclustered'
    const toCluster = toArt ? ((toArt.cluster_name as string | null) ?? 'Unclustered') : null

    if (!clusterMap.has(fromCluster)) continue
    if (toCluster === fromCluster) {
      clusterMap.get(fromCluster)!.internal_links++
    } else if (toCluster) {
      clusterMap.get(fromCluster)!.cross_links++
    }
  }

  const clusterStats = Array.from(clusterMap.entries()).map(([name, data]) => ({
    cluster_name: name,
    ...data,
    link_density: data.articles > 1 ? Math.round((data.internal_links / (data.articles * (data.articles - 1))) * 100) / 100 : 0,
  })).sort((a, b) => b.internal_links - a.internal_links)

  return NextResponse.json({
    summary: {
      total_links: links.length,
      total_articles: articles.length,
      orphan_count: articleStats.filter((a) => a.is_orphan).length,
      pillar_link_count: links.filter((l) => l.is_pillar_link).length,
    },
    top_linked_articles: articleStats.slice(0, 20),
    orphaned_articles: articleStats.filter((a) => a.is_orphan).slice(0, 50),
    cluster_connectivity: clusterStats,
  })
}
