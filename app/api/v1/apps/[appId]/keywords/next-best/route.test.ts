import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqNotChain } from '@/lib/testing/supabase-mocks'

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

/** Keywords: select → eq → eq → is → order → limit; optional eq after limit (cluster / intent). */
function keywordsNextBestChain(
  result: { data: unknown; error: unknown },
  extraEqAfterLimit: number
) {
  const limitMock =
    extraEqAfterLimit === 0
      ? vi.fn().mockResolvedValue(result)
      : vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue(result),
          }),
        })
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_keywords') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: limitMock,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return buildSelectEqNotChain({
          data: [{ focus_keyword: 'already-covered' }],
          error: null,
        })
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/next-best', () => {
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

  it('returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      keywordsNextBestChain({ data: [], error: { message: 'db' } }, 0)
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('excludes keywords already used as focus_keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      keywordsNextBestChain(
        {
          data: [
            {
              id: 'k1',
              keyword: 'already-covered',
              cluster_name: null,
              search_volume: 100,
              opportunity_score: 9,
              intent_type: 'informational',
              status: 'active',
              article_id: null,
            },
            {
              id: 'k2',
              keyword: 'fresh-target',
              cluster_name: 'hub',
              search_volume: 200,
              opportunity_score: 8,
              intent_type: 'commercial',
              status: 'active',
              article_id: null,
            },
          ],
          error: null,
        },
        0
      )
    )
    const res = await GET(new NextRequest('http://localhost/?limit=10'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      recommendations: Array<{ keyword: string }>
    }
    expect(j.recommendations.some((r) => r.keyword === 'already-covered')).toBe(false)
    expect(j.recommendations.some((r) => r.keyword === 'fresh-target')).toBe(true)
  })

  it('applies cluster and intent filters after limit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      keywordsNextBestChain(
        {
          data: [
            {
              id: 'k3',
              keyword: 'only-one',
              cluster_name: 'hub',
              search_volume: 50,
              opportunity_score: 7,
              intent_type: 'informational',
              status: 'active',
              article_id: null,
            },
          ],
          error: null,
        },
        2
      )
    )
    const res = await GET(
      new NextRequest('http://localhost/?cluster=hub&intent_type=informational'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { recommendations: Array<{ keyword: string }> }
    expect(j.recommendations.length).toBeGreaterThan(0)
  })
})
