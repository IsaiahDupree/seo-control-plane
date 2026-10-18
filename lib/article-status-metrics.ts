import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ARTICLE_STATUS_LIST,
  type ArticlePipelineStatus,
} from '@/lib/schemas'

export type ArticleStatusCount = { status: string; count: number }

/**
 * Parallel COUNTs per known article status, optional `app_id` filter, plus `other` when totals diverge.
 */
export async function fetchArticleStatusBreakdown(
  db: SupabaseClient,
  filter: { appId?: string } = {}
): Promise<{
  totalArticles: number
  statusTotals: Record<ArticlePipelineStatus, number>
  statusBreakdown: ArticleStatusCount[]
}> {
  const scope = () => {
    let q = db.from('scp_articles').select('*', { count: 'exact', head: true })
    if (filter.appId) q = q.eq('app_id', filter.appId)
    return q
  }

  const statusCountQueries = ARTICLE_STATUS_LIST.map((status) => {
    let q = db
      .from('scp_articles')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    if (filter.appId) q = q.eq('app_id', filter.appId)
    return q
  })

  const [{ count: totalArticles }, ...statusCountResults] = await Promise.all([
    scope(),
    ...statusCountQueries,
  ])

  const statusTotals = {} as Record<ArticlePipelineStatus, number>
  ARTICLE_STATUS_LIST.forEach((status, i) => {
    statusTotals[status] = statusCountResults[i]?.count ?? 0
  })

  const statusBreakdown: ArticleStatusCount[] = [...ARTICLE_STATUS_LIST]
    .map((status) => ({ status, count: statusTotals[status] }))
    .filter((x) => x.count > 0)

  const knownSum = ARTICLE_STATUS_LIST.reduce((s, st) => s + statusTotals[st], 0)
  const total = totalArticles ?? 0
  const otherCount = Math.max(0, total - knownSum)
  if (otherCount > 0) {
    statusBreakdown.push({ status: 'other', count: otherCount })
  }
  statusBreakdown.sort((a, b) => b.count - a.count)

  return {
    totalArticles: total,
    statusTotals,
    statusBreakdown,
  }
}
