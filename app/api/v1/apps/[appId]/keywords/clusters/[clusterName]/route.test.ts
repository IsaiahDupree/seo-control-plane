import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildUpdateEqEqThenChain } from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { DELETE, GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx(clusterName = 'Topic%20Cluster') {
  return { params: Promise.resolve({ appId: APP_ID, clusterName }) }
}

function kwOrderChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function articlesNotChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

describe('/api/v1/apps/[appId]/keywords/clusters/[clusterName]', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return kwOrderChain({ data: null, error: { message: 'db' } })
        }
        return articlesNotChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('GET returns stats and decodes cluster name', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return kwOrderChain({
            data: [
              { id: 'k1', keyword: 'a', status: 'active', search_volume: 10, opportunity_score: 5, intent_type: 'informational', article_id: null },
              { id: 'k2', keyword: 'b', status: 'active', search_volume: 20, opportunity_score: 6, intent_type: 'informational', article_id: 'a1' },
            ],
            error: null,
          })
        }
        return articlesNotChain({
          data: [
            { id: 'a1', slug: 'x', title: 'X', status: 'published', published_at: '2026-01-01', gsc_avg_position: 5, gsc_clicks: 10, word_count: 1000 },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx('Topic%20Cluster'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { cluster_name: string; stats: { total_keywords: number; coverage_pct: number } }
    expect(j.cluster_name).toBe('Topic Cluster')
    expect(j.stats.total_keywords).toBe(2)
    expect(j.stats.coverage_pct).toBe(50)
  })

  it('DELETE reassigns keywords and articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        return buildUpdateEqEqThenChain({ error: null })
      }),
    })
    const res = await DELETE(new NextRequest('http://localhost/?reassign_to=New', { method: 'DELETE' }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { deleted_cluster: string; reassigned_to: string | null }
    expect(j.deleted_cluster).toBe('Topic Cluster')
    expect(j.reassigned_to).toBe('New')
    expect(fromCalls).toBe(2)
  })
})

