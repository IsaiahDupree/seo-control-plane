import type { SupabaseClient } from '@supabase/supabase-js'
import {
  KEYWORD_STATUS_LIST,
  type KeywordPipelineStatus,
} from '@/lib/schemas'

export type KeywordStatusCount = { status: string; count: number }

/**
 * Parallel COUNTs per known keyword status, optional `app_id` filter, plus `other` when totals diverge.
 */
export async function fetchKeywordStatusBreakdown(
  db: SupabaseClient,
  filter: { appId?: string } = {}
): Promise<{
  totalKeywords: number
  statusTotals: Record<KeywordPipelineStatus, number>
  statusBreakdown: KeywordStatusCount[]
}> {
  const scope = () => {
    let q = db.from('scp_keywords').select('*', { count: 'exact', head: true })
    if (filter.appId) q = q.eq('app_id', filter.appId)
    return q
  }

  const statusCountQueries = KEYWORD_STATUS_LIST.map((status) => {
    let q = db
      .from('scp_keywords')
      .select('*', { count: 'exact', head: true })
      .eq('status', status)
    if (filter.appId) q = q.eq('app_id', filter.appId)
    return q
  })

  const [{ count: totalKeywords }, ...statusCountResults] = await Promise.all([
    scope(),
    ...statusCountQueries,
  ])

  const statusTotals = {} as Record<KeywordPipelineStatus, number>
  KEYWORD_STATUS_LIST.forEach((status, i) => {
    statusTotals[status] = statusCountResults[i]?.count ?? 0
  })

  const statusBreakdown: KeywordStatusCount[] = [...KEYWORD_STATUS_LIST]
    .map((status) => ({ status, count: statusTotals[status] }))
    .filter((x) => x.count > 0)

  const knownSum = KEYWORD_STATUS_LIST.reduce((s, st) => s + statusTotals[st], 0)
  const total = totalKeywords ?? 0
  const otherCount = Math.max(0, total - knownSum)
  if (otherCount > 0) {
    statusBreakdown.push({ status: 'other', count: otherCount })
  }
  statusBreakdown.sort((a, b) => b.count - a.count)

  return {
    totalKeywords: total,
    statusTotals,
    statusBreakdown,
  }
}
