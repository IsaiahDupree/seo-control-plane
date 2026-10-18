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

function gscTrendsChain(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(result),
              }),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/gsc-trends', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscTrendsChain({ data: null, error: { message: 'db' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns trend buckets and top queries', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscTrendsChain({
        data: [
          {
            date: '2026-01-10',
            clicks: 5,
            impressions: 100,
            ctr: 0.05,
            avg_position: 8,
            query: 'alpha',
          },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?since=2026-01-01&until=2026-01-31&granularity=day'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      period: { granularity: string }
      trend: Array<{ clicks: number }>
      top_queries: Array<{ query: string }>
    }
    expect(j.period.granularity).toBe('day')
    expect(j.trend.length).toBeGreaterThan(0)
    expect(j.top_queries.some((q) => q.query === 'alpha')).toBe(true)
  })
})
