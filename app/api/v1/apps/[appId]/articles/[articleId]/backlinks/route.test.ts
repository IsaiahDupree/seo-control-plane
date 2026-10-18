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

const articleRow = {
  id: ARTICLE_ID,
  slug: 'post',
  focus_keyword: 'kw',
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/backlinks', () => {
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

  it('returns backlinks without dofollow filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    const row = {
      id: 'b1',
      source_url: 'https://ext.com/p',
      source_domain: 'ext.com',
      anchor_text: 'x',
      domain_rating: 40,
      is_dofollow: true,
      first_seen_at: null,
      created_at: '2026-01-01',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: articleRow,
            error: null,
          })
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=10'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { total_backlinks: number; backlinks: unknown[] }
    expect(j.total_backlinks).toBe(1)
    expect(j.backlinks).toHaveLength(1)
  })

  it('applies dofollow filter with eq after limit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: articleRow,
            error: null,
          })
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await GET(
      new NextRequest('http://localhost/?dofollow_only=true'),
      ctx()
    )
    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/backlinks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backlinks: [] }),
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('upserts backlinks', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ upsert })),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backlinks: [
            {
              source_url: 'https://example.com/ref',
              source_domain: 'example.com',
            },
          ],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const j = (await res.json()) as { stored: number }
    expect(j.stored).toBe(1)
    expect(upsert).toHaveBeenCalled()
  })
})
