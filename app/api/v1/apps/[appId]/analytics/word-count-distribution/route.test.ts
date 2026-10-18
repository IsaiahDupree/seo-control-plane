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

function articlesChain(result: { data: unknown; error: unknown }, withStatusEq: boolean) {
  const limitNode = { limit: vi.fn().mockResolvedValue(result) }
  const leaf = withStatusEq ? { eq: vi.fn().mockReturnValue(limitNode) } : { not: vi.fn().mockReturnValue(limitNode) }
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(leaf),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/word-count-distribution', () => {
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

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => articlesChain({ data: null, error: { message: 'db' } }, false)),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('computes distribution buckets and cluster breakdown', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        articlesChain(
          {
            data: [
              { id: 'a1', status: 'published', cluster_name: 'C1', body_mdx: 'one two three four five' },
              { id: 'a2', status: 'published', cluster_name: 'C1', body_mdx: 'one two three' },
              { id: 'a3', status: 'draft', cluster_name: null, body_mdx: '' },
            ],
            error: null,
          },
          false
        )
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_articles: number
      avg_word_count: number
      distribution: Array<{ bucket: string; count: number; pct: number }>
      by_cluster: Array<{ cluster_name: string; article_count: number; avg_word_count: number }>
    }
    expect(j.total_articles).toBe(3)
    expect(j.distribution.length).toBeGreaterThan(0)
    expect(j.by_cluster.find((c) => c.cluster_name === 'C1')?.article_count).toBe(2)
  })

  it('applies status filter when provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => articlesChain({ data: [], error: null }, true)),
    })
    const res = await GET(new NextRequest('http://localhost/?status=published'), ctx())
    expect(res.status).toBe(200)
  })
})

