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

function gscChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/keyword-ranking-distribution', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => gscChain({ data: null, error: { message: 'db' } })),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-01-01'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('dedupes by query (best position) and returns distribution', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        gscChain({
          data: [
            { query: 'alpha', avg_position: 12, clicks: 1, impressions: 10 },
            { query: 'alpha', avg_position: 4, clicks: 2, impressions: 20 },
            { query: 'beta', avg_position: 2, clicks: 5, impressions: 50 },
          ],
          error: null,
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-01-01'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_keywords_tracked: number
      top_positions_pct: number
      distribution: Array<{ position_range: string; keyword_count: number; total_clicks: number; total_impressions: number }>
    }
    expect(j.total_keywords_tracked).toBe(2)
    expect(j.distribution.find((d) => d.position_range === '1-3')?.keyword_count).toBe(1)
    expect(j.top_positions_pct).toBeGreaterThan(0)
  })
})

