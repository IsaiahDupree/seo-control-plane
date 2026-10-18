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
const KEYWORD_ID = '660e8400-e29b-41d4-a716-446655440003'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, keywordId: KEYWORD_ID }),
  }
}

function articlesNotArchivedChain(rows: unknown[], err: unknown) {
  const payload = { data: rows, error: err }
  return buildThenableFluentChain(['select', 'eq', 'not'], payload)
}

describe('GET /api/v1/apps/[appId]/keywords/[keywordId]/articles', () => {
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

  it('returns 404 when keyword missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 500 when articles query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEYWORD_ID,
              keyword: 'alpha',
              cluster_name: null,
              article_id: null,
            },
            error: null,
          })
        }
        return articlesNotArchivedChain([], { message: 'db' })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('matches focus and secondary keywords case-insensitively', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEYWORD_ID,
              keyword: 'Beta Topic',
              cluster_name: 'c',
              article_id: null,
            },
            error: null,
          })
        }
        return articlesNotArchivedChain(
          [
            {
              id: 'a1',
              slug: 'one',
              title: 'One',
              status: 'published',
              published_at: null,
              gsc_clicks: 1,
              gsc_avg_position: 5,
              focus_keyword: 'beta topic',
              secondary_keywords: [],
            },
            {
              id: 'a2',
              slug: 'two',
              title: 'Two',
              status: 'draft',
              published_at: null,
              gsc_clicks: 0,
              gsc_avg_position: null,
              focus_keyword: 'other',
              secondary_keywords: ['Beta Topic'],
            },
          ],
          null
        )
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      keyword: string
      articles: Array<{ article_id: string; is_focus_keyword: boolean }>
    }
    expect(j.keyword).toBe('Beta Topic')
    expect(j.articles).toHaveLength(2)
    expect(j.articles.filter((a) => a.is_focus_keyword)).toHaveLength(1)
  })
})
