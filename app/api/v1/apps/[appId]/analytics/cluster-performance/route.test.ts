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

function articlesClusterChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function keywordsClusterChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/cluster-performance', () => {
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

  it('returns 500 when articles query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return articlesClusterChain({ data: null, error: { message: 'db' } })
        }
        return keywordsClusterChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'query_failed'
    )
  })

  it('aggregates clusters and sorts by clicks', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return articlesClusterChain({
            data: [
              {
                cluster_name: 'A',
                status: 'published',
                gsc_clicks: 10,
                gsc_impressions: 100,
                gsc_avg_position: 5,
                word_count: 500,
              },
              {
                cluster_name: 'B',
                status: 'published',
                gsc_clicks: 3,
                gsc_impressions: 30,
                gsc_avg_position: 8,
                word_count: 300,
              },
            ],
            error: null,
          })
        }
        return keywordsClusterChain({
          data: [
            { cluster_name: 'A', status: 'active', search_volume: 100, opportunity_score: 10 },
            { cluster_name: 'B', status: 'active', search_volume: 50, opportunity_score: 5 },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?sort_by=clicks&limit=10'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      clusters: Array<{ cluster_name: string; total_gsc_clicks: number }>
      sort_by: string
    }
    expect(j.sort_by).toBe('clicks')
    expect(j.clusters[0].cluster_name).toBe('A')
    expect(j.clusters[0].total_gsc_clicks).toBe(10)
  })
})

