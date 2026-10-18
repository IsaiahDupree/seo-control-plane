import { describe, expect, it, vi } from 'vitest'
import type { ArticlePipelineStatus } from '@/lib/schemas'
import { fetchArticleStatusBreakdown } from './article-status-metrics'

function createThenable(payload: { count: number | null; error: unknown }) {
  const p = Promise.resolve(payload)
  return { then: p.then.bind(p) as typeof p.then }
}

/**
 * Mock client: resolves counts from `.eq()` args (order-safe under Promise.all).
 */
function mockArticlesDb(
  filter: { appId?: string },
  opts: { total: number; byStatus: Partial<Record<ArticlePipelineStatus, number>> }
) {
  return {
    from: vi.fn((table: string) => {
      expect(table).toBe('scp_articles')
      return {
        select: vi.fn().mockReturnValue({
          eq(col: string, val: string) {
            if (col === 'app_id') {
              return createThenable({ count: opts.total, error: null })
            }
            if (col === 'status') {
              const c = opts.byStatus[val as ArticlePipelineStatus] ?? 0
              if (filter.appId) {
                return {
                  eq(c2: string, v2: string) {
                    expect(c2).toBe('app_id')
                    expect(v2).toBe(filter.appId)
                    return createThenable({ count: c, error: null })
                  },
                }
              }
              return createThenable({ count: c, error: null })
            }
            throw new Error(`unexpected eq(${col})`)
          },
          then(onF: (r: unknown) => unknown, onR?: (reason: unknown) => unknown) {
            return Promise.resolve({ count: opts.total, error: null }).then(onF, onR)
          },
        }),
      }
    }),
  }
}

describe('fetchArticleStatusBreakdown', () => {
  it('returns zeroed totals and empty breakdown when counts are zero', async () => {
    const db = mockArticlesDb({}, { total: 0, byStatus: {} })
    const out = await fetchArticleStatusBreakdown(db as never, {})
    expect(out.totalArticles).toBe(0)
    expect(out.statusBreakdown).toEqual([])
  })

  it('adds other when total exceeds sum of known statuses', async () => {
    const db = mockArticlesDb({}, {
      total: 25,
      byStatus: { draft: 10, brief_pending: 5 },
    })
    const out = await fetchArticleStatusBreakdown(db as never, {})
    expect(out.totalArticles).toBe(25)
    expect(out.statusTotals.draft).toBe(10)
    expect(out.statusTotals.brief_pending).toBe(5)
    expect(out.statusBreakdown).toContainEqual({ status: 'other', count: 10 })
  })

  it('scopes status counts by app_id when filter.appId is set', async () => {
    const db = mockArticlesDb(
      { appId: 'app-xyz' },
      { total: 3, byStatus: { approved: 2 } }
    )
    const out = await fetchArticleStatusBreakdown(db as never, { appId: 'app-xyz' })
    expect(out.totalArticles).toBe(3)
    expect(out.statusTotals.approved).toBe(2)
    expect(db.from).toHaveBeenCalled()
  })
})
