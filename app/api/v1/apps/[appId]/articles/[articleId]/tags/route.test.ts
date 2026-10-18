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

import { DELETE, GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function maybeSingleArticle(
  data: { id?: string; slug?: string; tags?: string[] | null } | null,
  err: unknown
) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data, error: err }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/tags', () => {
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
    mockCreateAdminClient.mockReturnValue(maybeSingleArticle(null, null))
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns tags and count', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      maybeSingleArticle(
        { slug: 'post', tags: ['seo', 'guide'] },
        null
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { tags: string[]; count: number }
    expect(j.tags).toEqual(['seo', 'guide'])
    expect(j.count).toBe(2)
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/tags', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tags: ['a'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tags: [] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('merges tags when replace is false', async () => {
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
                    data: { id: ARTICLE_ID, tags: ['a'] },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tags: ['b'], replace: false }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { tags: string[]; count: number }
    expect(j.tags.sort()).toEqual(['a', 'b'])
    expect(j.count).toBe(2)
  })

  it('returns 500 when update fails', async () => {
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
                    data: { id: ARTICLE_ID, tags: [] },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'x' } }),
          }),
        }
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tags: ['t'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('update_failed')
  })
})

describe('DELETE /api/v1/apps/[appId]/articles/[articleId]/tags', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when tag query param missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await DELETE(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('missing_tag')
  })

  it('removes tag and returns updated list', async () => {
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
                    data: { id: ARTICLE_ID, tags: ['keep', 'drop'] },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })
    const res = await DELETE(
      new NextRequest('http://localhost/?tag=drop'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { removed: string; tags: string[] }
    expect(j.removed).toBe('drop')
    expect(j.tags).toEqual(['keep'])
  })
})
