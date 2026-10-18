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

function linksChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
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

describe('GET /api/v1/apps/[appId]/analytics/link-graph', () => {
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

  it('returns 500 when link query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_internal_link_edges') return linksChain({ data: null, error: { message: 'db' } })
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns summary, top linked, orphans, and cluster connectivity', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_internal_link_edges') {
          return linksChain({
            data: [
              { from_article_id: 'a1', to_article_id: 'a2', is_pillar_link: true },
              { from_article_id: 'a1', to_article_id: 'a3', is_pillar_link: false },
              { from_article_id: 'a2', to_article_id: 'a3', is_pillar_link: false },
            ],
            error: null,
          })
        }
        return articlesChain({
          data: [
            { id: 'a1', slug: 'one', title: 'One', cluster_name: 'C1', status: 'published' },
            { id: 'a2', slug: 'two', title: 'Two', cluster_name: 'C1', status: 'ranked' },
            { id: 'a3', slug: 'three', title: 'Three', cluster_name: 'C2', status: 'indexed' },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      summary: { total_links: number; total_articles: number; orphan_count: number; pillar_link_count: number }
      top_linked_articles: Array<{ article_id: string; in_links: number }>
      orphaned_articles: Array<{ article_id: string }>
      cluster_connectivity: Array<{ cluster_name: string; internal_links: number; cross_links: number }>
    }
    expect(j.summary.total_links).toBe(3)
    expect(j.summary.total_articles).toBe(3)
    expect(j.summary.pillar_link_count).toBe(1)
    expect(j.top_linked_articles.length).toBeGreaterThan(0)
    expect(j.cluster_connectivity.length).toBeGreaterThan(0)
  })
})

