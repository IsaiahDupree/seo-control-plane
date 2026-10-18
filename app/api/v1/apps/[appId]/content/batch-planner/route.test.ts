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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const KW_ID = '990e8400-e29b-41d4-a716-446655440099'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function adminForPlanner(kwResolved: {
  data: unknown[] | null
  error: unknown
  useClusterEq?: boolean
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_keywords') {
        const terminal = vi.fn().mockResolvedValue({
          data: kwResolved.data,
          error: kwResolved.error,
        })
        const limitMock = kwResolved.useClusterEq
          ? vi.fn().mockReturnValue({ eq: terminal })
          : vi.fn().mockResolvedValue({
              data: kwResolved.data,
              error: kwResolved.error,
            })
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
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

describe('POST /api/v1/apps/[appId]/content/batch-planner', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      adminForPlanner({ data: null, error: { message: 'timeout' } })
    )
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns empty plan when keywords are covered by articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  is: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: KW_ID,
                            keyword: 'overlap',
                            cluster_name: 'c',
                            search_volume: 10,
                            opportunity_score: 5,
                            intent_type: 'informational',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({
                  data: [{ id: 'a1', focus_keyword: 'overlap' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    })
    const res = await POST(jsonPost({ batch_size: 5 }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { batch_size: number; plan: unknown[] }
    expect(j.batch_size).toBe(0)
    expect(j.plan).toEqual([])
  })

  it('returns plan rows for uncovered keywords', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      adminForPlanner({
        data: [
          {
            id: KW_ID,
            keyword: 'uncovered kw',
            cluster_name: 'hub',
            search_volume: 200,
            opportunity_score: 12,
            intent_type: 'commercial',
          },
        ],
        error: null,
      })
    )
    const res = await POST(jsonPost({ batch_size: 10 }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      batch_size: number
      plan: Array<{ keyword: string; suggested_content_type: string }>
      estimated_total_words: number
    }
    expect(j.batch_size).toBe(1)
    expect(j.plan[0].keyword).toBe('uncovered kw')
    expect(j.plan[0].suggested_content_type).toBe('comparison')
    expect(j.estimated_total_words).toBeGreaterThan(0)
  })

  it('applies cluster_name filter via extra eq after limit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      adminForPlanner({
        data: [
          {
            id: KW_ID,
            keyword: 'in cluster',
            cluster_name: 'alpha',
            search_volume: 1,
            opportunity_score: 1,
            intent_type: 'informational',
          },
        ],
        error: null,
        useClusterEq: true,
      })
    )
    const res = await POST(jsonPost({ cluster_name: 'alpha' }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { cluster_name: string | null; plan: unknown[] }
    expect(j.cluster_name).toBe('alpha')
    expect(j.plan).toHaveLength(1)
  })
})
