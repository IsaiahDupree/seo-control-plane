// F-CP-074: Orphaned articles detection
// Articles that receive no internal links from other published articles.
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

  const [articlesResult, linksResult] = await Promise.all([
    admin
      .from('scp_articles')
      .select('id, slug, title, status, focus_keyword, published_at, cluster_name')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked'])
      .order('published_at', { ascending: false }),
    admin
      .from('scp_internal_links')
      .select('target_article_id')
      .eq('app_id', appId),
  ])

  if (articlesResult.error) return jsonError(500, 'query_failed', articlesResult.error.message)

  const articles = articlesResult.data ?? []
  const linkedArticleIds = new Set(
    (linksResult.data ?? []).map((l) => l.target_article_id).filter(Boolean)
  )

  const orphaned = articles.filter((a) => !linkedArticleIds.has(a.id))

  // Group by cluster to give context
  const byCluster: Record<string, typeof orphaned> = {}
  for (const a of orphaned) {
    const cluster = (a as Record<string, unknown>).cluster_name as string | null ?? 'Unclustered'
    if (!byCluster[cluster]) byCluster[cluster] = []
    byCluster[cluster].push(a)
  }

  const clusterSummary = Object.entries(byCluster).map(([cluster, arts]) => ({
    cluster_name: cluster,
    orphaned_count: arts.length,
    articles: arts.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      focus_keyword: a.focus_keyword ?? null,
      published_at: a.published_at,
    })),
  })).sort((a, b) => b.orphaned_count - a.orphaned_count)

  return NextResponse.json({
    summary: {
      total_published: articles.length,
      orphaned_count: orphaned.length,
      orphaned_pct: articles.length > 0 ? Math.round((orphaned.length / articles.length) * 100) : 0,
      linked_count: articles.length - orphaned.length,
    },
    by_cluster: clusterSummary,
    orphaned_articles: orphaned.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      focus_keyword: a.focus_keyword ?? null,
      cluster_name: (a as Record<string, unknown>).cluster_name as string | null ?? null,
      published_at: a.published_at,
    })),
  })
}
