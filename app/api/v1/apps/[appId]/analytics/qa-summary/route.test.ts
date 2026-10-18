import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

/** Base chain: select → eq → not → await; optional extra eq(cluster) before await. */
function qaSummaryChain(
  result: { data: unknown; error: unknown },
  withClusterEq: boolean
) {
  void withClusterEq
  return {
    from: vi.fn(() =>
      buildThenableFluentChain(['select', 'eq', 'not'], result)
    ),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/qa-summary', () => {
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
    mockCreateAdminClient.mockReturnValue(
      qaSummaryChain({ data: null, error: { message: 'db' } }, false)
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('aggregates QA and readability averages', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      qaSummaryChain(
        {
          data: [
            {
              id: 'a1',
              slug: 'low',
              status: 'draft',
              cluster_name: 'hub',
              qa_score: 40,
              readability_score: 60,
              word_count: 500,
            },
            {
              id: 'a2',
              slug: 'high',
              status: 'published',
              cluster_name: 'hub',
              qa_score: 95,
              readability_score: 80,
              word_count: 900,
            },
          ],
          error: null,
        },
        false
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_articles: number
      articles_with_qa: number
      avg_qa_score: number | null
      lowest_scoring_articles: Array<{ slug: string }>
    }
    expect(j.total_articles).toBe(2)
    expect(j.articles_with_qa).toBe(2)
    expect(j.avg_qa_score).not.toBeNull()
    expect(j.lowest_scoring_articles.some((x) => x.slug === 'low')).toBe(true)
  })

  it('applies cluster filter with extra eq', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      qaSummaryChain(
        {
          data: [
            {
              id: 'a1',
              slug: 'x',
              status: 'draft',
              cluster_name: 'only',
              qa_score: 88,
              readability_score: null,
              word_count: 100,
            },
          ],
          error: null,
        },
        true
      )
    )
    const res = await GET(
      new NextRequest('http://localhost/?cluster=only'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { cluster_filter: string | null }
    expect(j.cluster_filter).toBe('only')
  })
})
