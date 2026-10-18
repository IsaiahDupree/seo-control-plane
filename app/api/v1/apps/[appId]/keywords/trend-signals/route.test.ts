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

describe('GET /api/v1/apps/[appId]/keywords/trend-signals', () => {
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

  it('returns 500 when GSC query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'db' } }),
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns trends derived from first and second window halves', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const windowDays = 60
    const nowMs = Date.now()
    const midpointMs = nowMs - (windowDays / 2) * 24 * 60 * 60 * 1000
    const early = new Date(midpointMs - 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    const late = new Date(midpointMs + 5 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    { query: 'alpha', clicks: 10, impressions: 100, avg_position: 8, date: early },
                    { query: 'alpha', clicks: 20, impressions: 200, avg_position: 6, date: late },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(
      new NextRequest(`http://localhost/?window_days=${windowDays}&limit=10`),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      window_days: number
      trends: Array<{ query: string; signal: string; click_pct_change: number | null }>
    }
    expect(j.window_days).toBe(windowDays)
    expect(j.trends.some((t) => t.query === 'alpha')).toBe(true)
    const alpha = j.trends.find((t) => t.query === 'alpha')
    expect(alpha?.signal).toBe('rising')
    expect(alpha?.click_pct_change).toBe(100)
  })
})
