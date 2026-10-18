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
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function serpChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        lte: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/share-of-voice', () => {
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

  it('returns 500 when gsc query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_gsc_performance') return gscChain({ data: null, error: { message: 'db' } })
        return serpChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('computes our metrics and competitor presence', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_gsc_performance') {
          return gscChain({
            data: [
              { query: 'alpha', clicks: 10, impressions: 100 },
              { query: 'beta', clicks: 5, impressions: 50 },
            ],
            error: null,
          })
        }
        return serpChain({
          data: [
            { domain: 'rival.com', keyword_id: 'k1' },
            { domain: 'rival.com', keyword_id: 'k2' },
            { domain: 'other.com', keyword_id: 'k2' },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-01-01'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      our_metrics: { total_clicks: number; total_impressions: number; keywords_with_impressions: number }
      competitors: Array<{ domain: string; keywords_in_top10: number }>
      total_tracked_keywords: number
    }
    expect(j.our_metrics.total_clicks).toBe(15)
    expect(j.our_metrics.total_impressions).toBe(150)
    expect(j.our_metrics.keywords_with_impressions).toBe(2)
    expect(j.total_tracked_keywords).toBe(2)
    expect(j.competitors[0].domain).toBe('rival.com')
  })
})

