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

import { GET, PATCH } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function maybeSingleArticle(data: Record<string, unknown> | null, err: unknown) {
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

describe('GET /api/v1/apps/[appId]/articles/[articleId]/meta', () => {
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
    mockCreateAdminClient.mockReturnValue(
      maybeSingleArticle(null, null)
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns meta fields', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      maybeSingleArticle(
        {
          slug: 'post',
          title: 'T',
          meta_title: 'MT',
          meta_description: 'MD',
          og_image_url: 'https://example.com/o.jpg',
          canonical_url: 'https://example.com/c',
          focus_keyword: 'kw',
          secondary_keywords: ['a', 'b'],
        },
        null
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      article_id: string
      meta_title: string | null
      secondary_keywords: string[]
    }
    expect(j.article_id).toBe(ARTICLE_ID)
    expect(j.meta_title).toBe('MT')
    expect(j.secondary_keywords).toEqual(['a', 'b'])
  })
})

describe('PATCH /api/v1/apps/[appId]/articles/[articleId]/meta', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ meta_title: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ og_image_url: 'not-a-url' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 400 when no fields provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('no_fields')
  })

  it('returns 200 after update', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      })),
    })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({
          meta_title: 'New title',
          meta_description: 'Desc',
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      article_id: string
      updated: { meta_title: string }
    }
    expect(j.article_id).toBe(ARTICLE_ID)
    expect(j.updated.meta_title).toBe('New title')
  })

  it('returns 500 when update fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'rls' } }),
          }),
        }),
      })),
    })
    const res = await PATCH(
      new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ focus_keyword: 'k' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('update_failed')
  })
})
