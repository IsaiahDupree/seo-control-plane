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

function decayChain(result: { data: unknown; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
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

describe('GET /api/v1/apps/[appId]/analytics/decay-signals', () => {
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
      decayChain({ data: [], error: { message: 'db' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns decaying articles above threshold', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    mockCreateAdminClient.mockReturnValue(
      decayChain({
        data: [
          {
            id: 'a1',
            slug: 's',
            title: 'T',
            cluster_name: null,
            focus_keyword: 'k',
            published_at: old,
            gsc_avg_position: 35,
            gsc_clicks: 0,
            gsc_impressions: 100,
            word_count: 400,
          },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?position_threshold=20&limit=10'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_decaying: number
      articles: Array<{ decay_score: number; decay_signals: string[] }>
    }
    expect(j.total_decaying).toBeGreaterThan(0)
    expect(j.articles[0].decay_score).toBeGreaterThan(0)
    expect(j.articles[0].decay_signals.length).toBeGreaterThan(0)
  })
})
