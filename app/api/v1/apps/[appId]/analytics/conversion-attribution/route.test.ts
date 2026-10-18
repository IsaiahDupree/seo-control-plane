import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function eventsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(result),
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

function articlesInChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/conversion-attribution', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when events query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_analytics_events') return eventsChain({ data: null, error: { message: 'db' } })
        return articlesInChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-01-01&until=2026-01-31'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('groups conversions by article and enriches with article info', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_analytics_events') {
          return eventsChain({
            data: [
              { article_id: 'a1', event_name: 'signup', payload: { revenue_usd: 0 }, occurred_at: '2026-01-02T00:00:00Z' },
              { article_id: 'a1', event_name: 'paid', payload: { revenue_usd: 49 }, occurred_at: '2026-01-03T00:00:00Z' },
              { article_id: null, event_name: 'signup', payload: {}, occurred_at: '2026-01-04T00:00:00Z' },
            ],
            error: null,
          })
        }
        return articlesInChain({
          data: [{ id: 'a1', slug: 'one', title: 'One', cluster_name: 'C1', focus_keyword: 'alpha' }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-01-01&until=2026-01-31&limit=50'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      totals: { total_conversions: number; articles_with_conversions: number }
      attributed: Array<{ article_id: string | null; total_conversions: number; estimated_revenue_usd: number }>
    }
    expect(j.totals.total_conversions).toBe(3)
    expect(j.totals.articles_with_conversions).toBe(1)
    const a1 = j.attributed.find((r) => r.article_id === 'a1')
    expect(a1?.total_conversions).toBe(2)
    expect(a1?.estimated_revenue_usd).toBe(49)
  })
})

