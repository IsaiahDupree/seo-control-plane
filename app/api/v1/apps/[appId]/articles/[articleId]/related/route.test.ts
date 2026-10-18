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
const OTHER_ID = '880e8400-e29b-41d4-a716-446655440008'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function candidatesNoClusterFilter(data: unknown[], err: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data, error: err }),
          }),
        }),
      }),
    }),
  }
}

function candidatesWithClusterEq(data: unknown[], err: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          neq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data, error: err }),
            }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/related', () => {
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

  it('returns 404 when source article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 500 when candidates query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: ARTICLE_ID,
                      slug: 'src',
                      title: 'Widgets overview guide',
                      description: null,
                      focus_keyword: 'widgets',
                      cluster_name: 'hub',
                      tags: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return candidatesNoClusterFilter([], { message: 'db' })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns related articles by token overlap', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: ARTICLE_ID,
                      slug: 'src',
                      title: 'Complete widgets tutorial for beginners',
                      description: 'Learn widgets',
                      focus_keyword: 'widgets',
                      cluster_name: 'hub',
                      tags: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return candidatesNoClusterFilter(
          [
            {
              id: OTHER_ID,
              slug: 'other',
              title: 'Advanced widgets patterns and examples',
              description: null,
              focus_keyword: 'widgets',
              cluster_name: 'other',
              published_at: '2026-01-01',
              gsc_avg_position: 10,
            },
          ],
          null
        )
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=5'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      related: Array<{ slug: string; relevance_score: number }>
    }
    expect(j.related.length).toBeGreaterThanOrEqual(1)
    expect(j.related[0].slug).toBe('other')
    expect(j.related[0].relevance_score).toBeGreaterThan(0.05)
  })

  it('filters same cluster when same_cluster=true', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: ARTICLE_ID,
                      slug: 'src',
                      title: 'Security authentication basics explained well',
                      description: null,
                      focus_keyword: 'authentication',
                      cluster_name: 'security',
                      tags: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return candidatesWithClusterEq(
          [
            {
              id: OTHER_ID,
              slug: 'peer',
              title: 'Authentication security deep dive explained',
              description: null,
              focus_keyword: 'authentication',
              cluster_name: 'security',
              published_at: '2026-01-02',
              gsc_avg_position: 5,
            },
          ],
          null
        )
      }),
    })
    const res = await GET(
      new NextRequest('http://localhost/?same_cluster=true'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      related: Array<{ cluster_name: string | null }>
    }
    expect(j.related.length).toBeGreaterThanOrEqual(1)
    expect(j.related[0].cluster_name).toBe('security')
  })
})
