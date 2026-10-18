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
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function candidatesChain(data: unknown[], err: unknown) {
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

describe('GET /api/v1/apps/[appId]/links/suggestions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(
      new NextRequest(`http://localhost/?keyword=widgets`),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when article_id and keyword missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('missing_params')
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
    const res = await GET(
      new NextRequest(`http://localhost/?article_id=${ARTICLE_ID}`),
      ctx()
    )
    expect(res.status).toBe(404)
  })

  it('returns 500 when candidates query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => candidatesChain([], { message: 'db' })),
    })
    const res = await GET(
      new NextRequest('http://localhost/?keyword=widgets'),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns suggestions for keyword-based search', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        candidatesChain(
          [
            {
              id: OTHER_ID,
              slug: 'widget-guide',
              title: 'Complete widgets guide for beginners',
              description: 'Everything about widgets',
              focus_keyword: 'widgets',
              cluster_name: 'hub',
              published_at: '2026-01-01',
              gsc_avg_position: 5,
            },
          ],
          null
        )
      ),
    })
    const res = await GET(
      new NextRequest('http://localhost/?keyword=widgets&limit=5'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      source_keyword: string | null
      suggestions: Array<{ slug: string; relevance_score: number }>
      total_candidates_evaluated: number
    }
    expect(j.source_keyword).toBe('widgets')
    expect(j.suggestions.length).toBeGreaterThanOrEqual(1)
    expect(j.suggestions[0].slug).toBe('widget-guide')
    expect(j.total_candidates_evaluated).toBe(1)
  })

  it('loads source article then scores candidates', async () => {
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
                      title: 'Authentication security overview',
                      description: 'Security patterns',
                      body_mdx: '',
                      focus_keyword: 'authentication',
                      cluster_name: 'security',
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return candidatesChain(
          [
            {
              id: OTHER_ID,
              slug: 'auth-deep-dive',
              title: 'Authentication deep dive security guide',
              description: null,
              focus_keyword: 'authentication',
              cluster_name: 'security',
              published_at: '2026-01-02',
              gsc_avg_position: 8,
            },
          ],
          null
        )
      }),
    })
    const res = await GET(
      new NextRequest(`http://localhost/?article_id=${ARTICLE_ID}`),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      source_article_id: string | null
      suggestions: Array<{ same_cluster: boolean }>
    }
    expect(j.source_article_id).toBe(ARTICLE_ID)
    expect(j.suggestions.length).toBeGreaterThanOrEqual(1)
    expect(j.suggestions[0].same_cluster).toBe(true)
  })
})
