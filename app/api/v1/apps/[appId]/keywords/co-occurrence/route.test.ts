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
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function articlesChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/co-occurrence', () => {
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

  it('returns 500 when keywords query fails', async () => {
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

  it('returns focus keyword co-occurrences when keyword param set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return keywordsChain({
            data: [
              { id: 'k1', keyword: 'alpha', cluster_name: null, search_volume: 10 },
              { id: 'k2', keyword: 'beta', cluster_name: 'c1', search_volume: 20 },
            ],
            error: null,
          })
        }
        return articlesChain({
          data: [
            { id: 'a1', body_mdx: 'alpha beta', focus_keyword: 'alpha' },
            { id: 'a2', body_mdx: 'alpha beta', focus_keyword: 'beta' },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?keyword=alpha'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      focus_keyword: string
      co_occurring_keywords: Array<{ keyword: string; co_occurrence_count: number }>
    }
    expect(j.focus_keyword).toBe('alpha')
    expect(j.co_occurring_keywords[0].keyword).toBe('beta')
    expect(j.co_occurring_keywords[0].co_occurrence_count).toBeGreaterThan(0)
  })

  it('returns top pairs when keyword param not set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return keywordsChain({
            data: [
              { id: 'k1', keyword: 'alpha', cluster_name: null, search_volume: 10 },
              { id: 'k2', keyword: 'beta', cluster_name: null, search_volume: 20 },
            ],
            error: null,
          })
        }
        return articlesChain({
          data: [{ id: 'a1', body_mdx: 'alpha beta', focus_keyword: 'alpha' }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { top_pairs: Array<{ keyword_a: string; keyword_b: string; count: number }> }
    expect(j.top_pairs).toHaveLength(1)
    expect(j.top_pairs[0].count).toBe(1)
  })
})

