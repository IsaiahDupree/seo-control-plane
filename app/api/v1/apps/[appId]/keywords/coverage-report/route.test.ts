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

function keywordsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

function articlesChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/coverage-report', () => {
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

  it('returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return keywordsChain({ data: null, error: { message: 'db' } })
        }
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('computes coverage, ranking, owned, and top opportunities', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return keywordsChain({
            data: [
              { id: 'k1', keyword: 'alpha', opportunity_score: 50, search_volume: 100, difficulty: 20, intent_type: 'informational', cluster_name: null, status: 'active' },
              { id: 'k2', keyword: 'beta', opportunity_score: 80, search_volume: 200, difficulty: 10, intent_type: 'transactional', cluster_name: 'c', status: 'active' },
              { id: 'k3', keyword: 'gamma', opportunity_score: 10, search_volume: 50, difficulty: 50, intent_type: 'informational', cluster_name: null, status: 'active' },
            ],
            error: null,
          })
        }
        return articlesChain({
          data: [
            { id: 'a1', focus_keyword: 'alpha', status: 'published', gsc_avg_position: 2 },
            { id: 'a2', focus_keyword: 'beta', status: 'ranked', gsc_avg_position: 9 },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      summary: { total_keywords: number; with_published_article: number; owned_top_3: number; ranking: number; pct_covered: number }
      top_opportunities: Array<{ keyword: string }>
    }
    expect(j.summary.total_keywords).toBe(3)
    expect(j.summary.with_published_article).toBe(2)
    expect(j.summary.ranking).toBe(2)
    expect(j.summary.owned_top_3).toBe(1)
    expect(j.top_opportunities.some((k) => k.keyword === 'gamma')).toBe(true)
  })
})

