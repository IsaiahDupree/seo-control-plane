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

function articlesChain(resolved: { data: unknown[]; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue(resolved),
              }),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/publish-velocity', () => {
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
      articlesChain({ data: [], error: { message: 'db' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns velocity buckets for published articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      articlesChain({
        data: [
          {
            id: 'a1',
            published_at: '2026-02-10T12:00:00Z',
            cluster_name: 'c1',
            word_count: 500,
          },
          {
            id: 'a2',
            published_at: '2026-02-10T15:00:00Z',
            cluster_name: 'c1',
            word_count: 300,
          },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest(
        'http://localhost/?since=2026-02-01&until=2026-02-28&granularity=day'
      ),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      period: { granularity: string }
      total_published: number
      velocity: Array<{ articles_published: number; total_words: number }>
    }
    expect(j.period.granularity).toBe('day')
    expect(j.total_published).toBe(2)
    expect(j.velocity.length).toBeGreaterThanOrEqual(1)
    const dayBucket = j.velocity.find((v) => v.period === '2026-02-10')
    expect(dayBucket?.articles_published).toBe(2)
    expect(dayBucket?.total_words).toBe(800)
  })
})
