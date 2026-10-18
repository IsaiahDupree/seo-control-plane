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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function clientForAssisted(
  eventsResult: { data: unknown; error: unknown },
  articlesResult: { data: unknown; error: unknown }
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_analytics_events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(eventsResult),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue(articlesResult),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/assisted-conversions', () => {
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

  it('returns 500 when events query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      clientForAssisted({ data: null, error: { message: 'db' } }, { data: [], error: null })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns empty articles when no events', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      clientForAssisted({ data: [], error: null }, { data: [], error: null })
    )
    const res = await GET(
      new NextRequest('http://localhost/?since=2026-01-01&until=2026-01-31'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { articles: unknown[]; period: { since: string } }
    expect(j.articles).toEqual([])
    expect(j.period.since).toBe('2026-01-01')
  })

  it('joins article metadata for attributed events', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      clientForAssisted(
        {
          data: [
            {
              article_id: ARTICLE_ID,
              event_name: 'assisted_conversion',
              payload: { conversion_type: 'signup', revenue_usd: 12.5 },
              occurred_at: '2026-01-15T12:00:00Z',
            },
          ],
          error: null,
        },
        {
          data: [
            {
              id: ARTICLE_ID,
              slug: 'post',
              title: 'Post',
              cluster_name: 'c1',
            },
          ],
          error: null,
        }
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      articles: Array<{ slug: string | null; assisted_conversions: number }>
    }
    expect(j.articles.length).toBeGreaterThan(0)
    const row = j.articles.find((a) => a.slug === 'post')
    expect(row?.assisted_conversions).toBe(1)
  })
})
