import { describe, expect, it, vi } from 'vitest'
import type { KeywordPipelineStatus } from '@/lib/schemas'
import { fetchKeywordStatusBreakdown } from './keyword-status-metrics'

function createThenable(payload: { count: number | null; error: unknown }) {
  const p = Promise.resolve(payload)
  return { then: p.then.bind(p) as typeof p.then }
}

function mockKeywordsDb(
  filter: { appId?: string },
  opts: { total: number; byStatus: Partial<Record<KeywordPipelineStatus, number>> }
) {
  return {
    from: vi.fn((table: string) => {
      expect(table).toBe('scp_keywords')
      return {
        select: vi.fn().mockReturnValue({
          eq(col: string, val: string) {
            if (col === 'app_id') {
              return createThenable({ count: opts.total, error: null })
            }
            if (col === 'status') {
              const c = opts.byStatus[val as KeywordPipelineStatus] ?? 0
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

describe('fetchKeywordStatusBreakdown', () => {
  it('returns empty breakdown when total is zero', async () => {
    const db = mockKeywordsDb({}, { total: 0, byStatus: {} })
    const out = await fetchKeywordStatusBreakdown(db as never, {})
    expect(out.totalKeywords).toBe(0)
    expect(out.statusBreakdown).toEqual([])
  })

  it('includes other when total exceeds sum of known statuses', async () => {
    const db = mockKeywordsDb({}, {
      total: 20,
      byStatus: { unassigned: 3, brief_created: 2 },
    })
    const out = await fetchKeywordStatusBreakdown(db as never, {})
    expect(out.totalKeywords).toBe(20)
    expect(out.statusBreakdown.find((x) => x.status === 'other')?.count).toBe(15)
  })
})
