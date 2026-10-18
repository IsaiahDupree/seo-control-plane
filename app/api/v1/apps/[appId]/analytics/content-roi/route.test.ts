import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function articlesChain(result: { data: unknown; error: unknown }) {
  return buildThenableFluentChain(
    ['select', 'eq', 'in', 'order', 'limit'],
    result
  )
}

describe('GET /api/v1/apps/[appId]/analytics/content-roi', () => {
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
      from: vi.fn(() => articlesChain({ data: null, error: { message: 'db' } })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('computes ROI and portfolio summary', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        articlesChain(
          {
            data: [
              { id: 'a1', slug: 'one', title: 'One', cluster_name: 'C1', published_at: '2026-01-01', gsc_clicks: 100, gsc_avg_position: 5, word_count: 1000 },
              { id: 'a2', slug: 'two', title: 'Two', cluster_name: 'C2', published_at: '2026-01-02', gsc_clicks: 10, gsc_avg_position: 12, word_count: 800 },
            ],
            error: null,
          }
        )
      ),
    })
    const res = await GET(
      new NextRequest('http://localhost/?avg_cpc_usd=2.5&cost_per_article_usd=150&limit=30'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      summary: { articles_analyzed: number; total_estimated_traffic_value_usd: number; portfolio_roi_pct: number | null }
      articles: Array<{ article_id: string; estimated_roi_pct: number | null; payback_clicks_needed: number | null }>
    }
    expect(j.summary.articles_analyzed).toBe(2)
    expect(j.articles[0].article_id).toBe('a1')
    expect(j.articles[0].payback_clicks_needed).toBeGreaterThan(0)
  })

  it('applies cluster filter when provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => articlesChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?cluster=C1'), ctx())
    expect(res.status).toBe(200)
  })
})

