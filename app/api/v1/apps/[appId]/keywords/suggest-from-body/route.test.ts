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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440001'

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

describe('POST /api/v1/apps/[appId]/keywords/suggest-from-body', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ body_text: 'hello' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when body text missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('missing_body')
  })

  it('returns 404 when article_id set but article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({ article_id: ARTICLE_ID }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_found')
  })

  it('suggests from body_text and loads existing keywords', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ keyword: 'already tracked phrase' }],
              error: null,
            }),
          }),
        }),
      })),
    })
    const text =
      'enterprise widget software platform teams building scalable systems widget software'
    const res = await POST(jsonPost({ body_text: text, limit: 10 }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      suggestions_count: number
      suggestions: Array<{ keyword: string }>
    }
    expect(j.suggestions_count).toBeGreaterThan(0)
    expect(
      j.suggestions.every((s) => s.keyword !== 'already tracked phrase')
    ).toBe(true)
  })

  it('loads body from article when article_id provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          fromCalls += 1
          return buildSelectEqEqMaybeSingleChain({
            data: {
              title: 'Widget guide',
              description: 'Learn widgets',
              body_mdx: 'widget platform enterprise software guide',
            },
            error: null,
          })
        }
        if (table === 'scp_keywords') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(jsonPost({ article_id: ARTICLE_ID }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { article_id: string | null }
    expect(j.article_id).toBe(ARTICLE_ID)
    expect(fromCalls).toBe(1)
  })
})
