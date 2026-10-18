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

function articlesChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
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

function pillarsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/topical-authority', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when articles query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') return articlesChain({ data: null, error: { message: 'db' } })
        if (table === 'scp_keywords') return keywordsChain({ data: [], error: null })
        return pillarsChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('computes overall authority and per-cluster scores', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return articlesChain({
            data: [
              { id: 'a1', cluster_name: 'C1', status: 'published', gsc_avg_position: 5, gsc_clicks: 100, focus_keyword: 'alpha' },
              { id: 'a2', cluster_name: 'C1', status: 'ranked', gsc_avg_position: 10, gsc_clicks: 10, focus_keyword: null },
              { id: 'a3', cluster_name: 'C2', status: 'indexed', gsc_avg_position: 20, gsc_clicks: 1, focus_keyword: 'beta' },
            ],
            error: null,
          })
        }
        if (table === 'scp_keywords') {
          return keywordsChain({
            data: [
              { keyword: 'alpha', cluster_name: 'C1', status: 'active', search_volume: 100, opportunity_score: 10, intent_type: 'informational' },
              { keyword: 'beta', cluster_name: 'C2', status: 'active', search_volume: 50, opportunity_score: 5, intent_type: 'commercial' },
            ],
            error: null,
          })
        }
        return pillarsChain({
          data: [{ id: 'p1', name: 'P', slug: 'p', parent_slug: null }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      overall_authority_score: number
      cluster_count: number
      pillar_count: number
      total_articles: number
      total_active_keywords: number
      clusters: Array<{ cluster_name: string; authority_score: number; breakdown: Record<string, number> }>
    }
    expect(j.pillar_count).toBe(1)
    expect(j.total_articles).toBe(3)
    expect(j.total_active_keywords).toBe(2)
    expect(j.cluster_count).toBe(2)
    expect(j.overall_authority_score).toBeGreaterThanOrEqual(0)
    expect(j.clusters[0].authority_score).toBeGreaterThanOrEqual(0)
  })
})

