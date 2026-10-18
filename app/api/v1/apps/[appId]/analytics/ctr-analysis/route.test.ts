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

function ctrGscChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(result),
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/ctr-analysis', () => {
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
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        ctrGscChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns underperforming queries when ctr lags expected', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        ctrGscChain({
          data: [
            {
              query: 'slow ctr',
              clicks: 1,
              impressions: 200,
              ctr: 0.001,
              avg_position: 3,
            },
          ],
          error: null,
        })
      ),
    })
    const res = await GET(
      new NextRequest('http://localhost/?since=2026-01-01&mode=underperforming'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      mode: string
      results: Array<{ query: string; ctr_gap_pct: number }>
    }
    expect(j.mode).toBe('underperforming')
    expect(j.results.length).toBeGreaterThan(0)
    expect(j.results[0].query).toBe('slow ctr')
    expect(j.results[0].ctr_gap_pct).toBeLessThan(0)
  })
})
