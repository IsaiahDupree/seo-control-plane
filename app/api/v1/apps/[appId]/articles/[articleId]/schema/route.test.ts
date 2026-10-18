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

function maybeSingle(data: Record<string, unknown> | null, err: unknown) {
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

describe('GET /api/v1/apps/[appId]/articles/[articleId]/schema', () => {
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
    mockCreateAdminClient.mockReturnValue(maybeSingle(null, null))
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns default Article schema when schema_json empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      maybeSingle(
        {
          slug: 's',
          title: 'Title',
          schema_json: {},
          focus_keyword: 'kw',
          published_at: '2026-01-01T00:00:00Z',
          canonical_url: 'https://example.com/s',
        },
        null
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      is_custom: boolean
      schema_json: { '@type': string; headline: string }
    }
    expect(j.is_custom).toBe(false)
    expect(j.schema_json['@type']).toBe('Article')
    expect(j.schema_json.headline).toBe('Title')
  })

  it('returns stored schema when present', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      maybeSingle(
        {
          slug: 's',
          title: 'T',
          schema_json: { '@type': 'BlogPosting', custom: true },
          focus_keyword: null,
          published_at: null,
          canonical_url: null,
        },
        null
      )
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { is_custom: boolean; schema_json: { custom: boolean } }
    expect(j.is_custom).toBe(true)
    expect(j.schema_json.custom).toBe(true)
  })
})

describe('PATCH /api/v1/apps/[appId]/articles/[articleId]/schema', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when schema_json missing', async () => {
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
    expect(j.error.code).toBe('validation_error')
  })

  it('updates schema_json', async () => {
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
          schema_json: { '@type': 'FAQPage', mainEntity: [] },
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      schema_json: { '@type': string }
    }
    expect(j.schema_json['@type']).toBe('FAQPage')
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
        body: JSON.stringify({ schema_json: { a: 1 } }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('update_failed')
  })
})
