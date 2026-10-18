import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSelectEqSingleChain } from '@/lib/testing/supabase-mocks'

const mockCountArticlesThisUtcMonth = vi.fn()

vi.mock('@/lib/monthly-limit', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/monthly-limit')>()
  return {
    ...actual,
    countArticlesThisUtcMonth: (...args: unknown[]) => mockCountArticlesThisUtcMonth(...args),
  }
})

import { getAppOperationalMetrics, getAppSummaryPayload } from './dashboard-metrics'

function headCountDoubleEq(count: number | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ count, error: null }),
      }),
    }),
  }
}

describe('getAppOperationalMetrics', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns counts from parallel head queries (null → 0)', async () => {
    let contentReqCalls = 0
    let articlesCalls = 0

    const from = vi.fn((table: string) => {
      if (table === 'scp_keywords') return headCountDoubleEq(11)
      if (table === 'scp_content_briefs') return headCountDoubleEq(3)
      if (table === 'scp_content_requests') {
        contentReqCalls += 1
        return headCountDoubleEq(contentReqCalls === 1 ? 4 : 2)
      }
      if (table === 'scp_articles') {
        articlesCalls += 1
        return headCountDoubleEq(articlesCalls === 1 ? 7 : 1)
      }
      throw new Error(`unexpected ${table}`)
    })

    const metrics = await getAppOperationalMetrics({ from } as never, 'app-x')

    expect(metrics).toEqual({
      unassigned_keywords: 11,
      pending_briefs: 3,
      open_content_requests: 4,
      processing_content_requests: 2,
      articles_approved: 7,
      articles_queued: 1,
    })
  })

  it('coalesces null counts to zero', async () => {
    const from = vi.fn(() => headCountDoubleEq(null))
    const metrics = await getAppOperationalMetrics({ from } as never, 'app-x')
    expect(metrics.unassigned_keywords).toBe(0)
    expect(metrics.articles_queued).toBe(0)
  })
})

describe('getAppSummaryPayload', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when app is not found', async () => {
    const from = vi.fn(() =>
      buildSelectEqSingleChain({ data: null, error: { message: 'nope' } })
    )
    const out = await getAppSummaryPayload({ from } as never, 'missing')
    expect(out).toEqual({ error: 'nope' })
  })

  it('returns error with default message when app data is null without error', async () => {
    const from = vi.fn(() => buildSelectEqSingleChain({ data: null, error: null }))
    const out = await getAppSummaryPayload({ from } as never, 'x')
    expect(out).toEqual({ error: 'App not found' })
  })

  it('returns app, usage, and metrics when found', async () => {
    mockCountArticlesThisUtcMonth.mockResolvedValue(12)

    let contentReqCalls = 0
    let articlesCalls = 0
    const from = vi.fn((table: string) => {
      if (table === 'scp_apps') {
        return buildSelectEqSingleChain({
          data: {
            id: 'a1',
            slug: 'sl',
            name: 'N',
            plan: 'pro',
            status: 'active',
            monthly_article_limit: 40,
            base_url: 'https://x.com',
            webhook_url: 'https://hook',
            created_at: 'c',
            updated_at: 'u',
          },
          error: null,
        })
      }
      if (table === 'scp_keywords') return headCountDoubleEq(1)
      if (table === 'scp_content_briefs') return headCountDoubleEq(0)
      if (table === 'scp_content_requests') {
        contentReqCalls += 1
        return headCountDoubleEq(contentReqCalls === 1 ? 2 : 0)
      }
      if (table === 'scp_articles') {
        articlesCalls += 1
        return headCountDoubleEq(articlesCalls === 1 ? 5 : 0)
      }
      throw new Error(`unexpected ${table}`)
    })

    const out = await getAppSummaryPayload({ from } as never, 'a1')

    if ('error' in out) throw new Error('expected success payload')

    expect(out.app).toMatchObject({
      id: 'a1',
      slug: 'sl',
      name: 'N',
      monthly_article_limit: 40,
      monthly_unlimited: false,
      webhook_configured: true,
    })
    expect(out.usage).toEqual({
      articles_this_utc_month: 12,
      monthly_remaining: 28,
    })
    expect(out.metrics).toEqual({
      unassigned_keywords: 1,
      pending_briefs: 0,
      open_content_requests: 2,
      processing_content_requests: 0,
      articles_approved: 5,
      articles_queued: 0,
    })
    expect(out.generated_at).toMatch(/^\d{4}-/)
  })

  it('sets monthly_remaining null when limit is unlimited', async () => {
    mockCountArticlesThisUtcMonth.mockResolvedValue(999)

    const from = vi.fn((table: string) => {
      if (table === 'scp_apps') {
        return buildSelectEqSingleChain({
          data: {
            id: 'a1',
            slug: 's',
            name: 'N',
            plan: 'pro',
            status: 'active',
            monthly_article_limit: 10_000,
            base_url: null,
            webhook_url: null,
            created_at: 'c',
            updated_at: 'u',
          },
          error: null,
        })
      }
      if (table === 'scp_keywords') return headCountDoubleEq(0)
      if (table === 'scp_content_briefs') return headCountDoubleEq(0)
      if (table === 'scp_content_requests') return headCountDoubleEq(0)
      if (table === 'scp_articles') return headCountDoubleEq(0)
      throw new Error(`unexpected ${table}`)
    })

    const out = await getAppSummaryPayload({ from } as never, 'a1')
    if ('error' in out) throw new Error('expected success')
    expect(out.usage.monthly_remaining).toBeNull()
    expect(out.app.monthly_unlimited).toBe(true)
    expect(out.app.webhook_configured).toBe(false)
  })
})
