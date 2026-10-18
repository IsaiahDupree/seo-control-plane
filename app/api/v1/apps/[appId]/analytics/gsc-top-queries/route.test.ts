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

function gscPerformanceChain(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/gsc-top-queries', () => {
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
      gscPerformanceChain({ data: null, error: { message: 'db' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('aggregates by query and sorts by clicks', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscPerformanceChain({
        data: [
          {
            query: 'alpha',
            clicks: 10,
            impressions: 100,
            ctr: 0.1,
            avg_position: 5,
            date: '2026-01-01',
          },
          {
            query: 'beta',
            clicks: 50,
            impressions: 200,
            ctr: 0.25,
            avg_position: 3,
            date: '2026-01-02',
          },
        ],
        error: null,
      })
    )
    const res = await GET(new NextRequest('http://localhost/?limit=5'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      top_queries: Array<{ query: string; total_clicks: number }>
      sort_by: string
    }
    expect(j.top_queries[0].query).toBe('beta')
    expect(j.top_queries[0].total_clicks).toBe(50)
    expect(j.sort_by).toBe('clicks')
  })

  it('sorts by impressions when requested', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscPerformanceChain({
        data: [
          { query: 'a', clicks: 1, impressions: 500, ctr: 0.01, avg_position: 10, date: '2026-01-01' },
          { query: 'b', clicks: 2, impressions: 100, ctr: 0.02, avg_position: 8, date: '2026-01-01' },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?sort_by=impressions'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { top_queries: Array<{ query: string }> }
    expect(j.top_queries[0].query).toBe('a')
  })
})
