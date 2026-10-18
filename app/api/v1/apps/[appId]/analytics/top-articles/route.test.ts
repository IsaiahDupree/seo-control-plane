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

const articleRow = {
  id: 'a1',
  slug: 's',
  title: 'T',
  cluster_name: 'c',
  focus_keyword: 'kw',
  published_at: '2026-01-01',
  gsc_clicks: 3,
  gsc_impressions: 10,
  gsc_avg_position: 2,
  gsc_ctr: 0.1,
  word_count: 500,
  qa_score: 90,
}

function chainNoCluster(orderResolved: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue(orderResolved),
            }),
          }),
        }),
      }),
    })),
  }
}

function chainWithCluster(orderResolved: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue(orderResolved),
              }),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/top-articles', () => {
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

  it('returns articles with default sort_by=clicks', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      chainNoCluster({ data: [articleRow], error: null })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      sort_by: string
      total: number
      articles: Array<{ article_id: string; gsc_clicks: number }>
    }
    expect(j.sort_by).toBe('clicks')
    expect(j.total).toBe(1)
    expect(j.articles[0].article_id).toBe('a1')
    expect(j.articles[0].gsc_clicks).toBe(3)
  })

  it('applies cluster filter when cluster query param set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      chainWithCluster({ data: [], error: null })
    )
    const res = await GET(
      new NextRequest('http://localhost/?cluster=my-cluster'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { cluster_filter: string | null; total: number }
    expect(j.cluster_filter).toBe('my-cluster')
    expect(j.total).toBe(0)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      chainNoCluster({ data: null, error: { message: 'query error' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })
})
