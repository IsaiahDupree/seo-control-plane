import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqEqMaybeSingleChain, buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function edgesChain(data: unknown[]) {
  const payload = { data, error: null }
  return buildThenableFluentChain(['select', 'eq'], payload)
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/internal-link-suggestions', () => {
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
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
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
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 's',
              title: 'widgets guide',
              description: 'about widgets',
              focus_keyword: 'widgets',
              cluster_name: 'c1',
              body_mdx: '',
            },
            error: null,
          })
        }
        if (calls === 2) {
          return candidatesChain(null, { message: 'fail' })
        }
        return edgesChain([])
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns ranked suggestions excluding linked targets', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          calls += 1
          if (calls === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: ARTICLE_ID,
                slug: 'source',
                title: 'widgets and gadgets overview',
                description: 'widgets',
                focus_keyword: 'widgets',
                cluster_name: 'cluster-a',
                body_mdx: '',
              },
              error: null,
            })
          }
          return candidatesChain(
            [
              {
                id: OTHER_ID,
                slug: 'target',
                title: 'widget installation widgets tips',
                description: 'widget',
                focus_keyword: 'widget',
                cluster_name: 'cluster-a',
              },
            ],
            null
          )
        }
        if (table === 'scp_internal_link_edges') {
          return edgesChain([{ to_article_id: '999' }])
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=5'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      suggestions: Array<{ article_id: string; relevance_score: number }>
      existing_outbound_links: number
    }
    expect(j.existing_outbound_links).toBe(1)
    expect(j.suggestions.length).toBeGreaterThan(0)
    expect(j.suggestions[0].article_id).toBe(OTHER_ID)
  })
})
