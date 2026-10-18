import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqEqMaybeSingleChain } from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/freshness', () => {
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
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns freshness payload', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const updatedAt = new Date().toISOString()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: ARTICLE_ID,
            slug: 's',
            title: 'T',
            status: 'published',
            published_at: null,
            updated_at: updatedAt,
            gsc_avg_position: null,
            focus_keyword: 'kw',
          },
          error: null,
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      freshness: { score: number; needs_refresh: boolean; urgency: string }
      recommendations: string[]
    }
    expect(typeof j.freshness.score).toBe('number')
    expect(j.freshness.urgency).toMatch(/^(low|medium|high)$/)
    expect(Array.isArray(j.recommendations)).toBe(true)
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/freshness', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns already queued when row exists', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 's',
              focus_keyword: 'k',
              status: 'published',
            },
            error: null,
          })
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'q1', status: 'queued' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await POST(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { queued: boolean }
    expect(j.queued).toBe(false)
  })

  it('inserts refresh queue row', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 's',
              focus_keyword: 'k',
              status: 'published',
            },
            error: null,
          })
        }
        if (fromCalls === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'new-q' },
                error: null,
              }),
            }),
          }),
        }
      }),
    })
    const res = await POST(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(201)
    const j = (await res.json()) as { queued: boolean; queue_id: string }
    expect(j.queued).toBe(true)
    expect(j.queue_id).toBe('new-q')
  })
})
