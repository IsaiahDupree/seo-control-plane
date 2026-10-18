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

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/audit-trail', () => {
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

  it('returns 404 when article missing', async () => {
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

  it('returns 500 when audit query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: ARTICLE_ID, slug: 's', title: 'T' },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'fail' },
                  }),
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns entries without action filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: ARTICLE_ID, slug: 's', title: 'Title' },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'e1',
                        action: 'edit',
                        entity_type: 'article',
                        entity_id: ARTICLE_ID,
                        performed_by: null,
                        payload: {},
                        performed_at: '2026-01-01',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { total: number; entries: unknown[] }
    expect(j.total).toBe(1)
    expect(j.entries).toHaveLength(1)
  })

  it('applies action filter with extra eq after limit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: ARTICLE_ID, slug: 's', title: 'T' },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'e2',
                          action: 'publish',
                          entity_type: 'article',
                          entity_id: ARTICLE_ID,
                          performed_by: null,
                          payload: {},
                          performed_at: '2026-01-02',
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
      }),
    })
    const res = await GET(
      new NextRequest('http://localhost/?action=publish&limit=10'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      entries: Array<{ action: string }>
    }
    expect(j.entries.every((e) => e.action === 'publish')).toBe(true)
  })
})
