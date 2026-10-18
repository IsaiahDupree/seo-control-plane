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

function appMaybeSingle(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  }
}

function kwSelectChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}

function articlesFocusChain(rows: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  }
}

describe('POST /api/v1/apps/[appId]/briefs/bulk-generate', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ count: 5 }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when app missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => appMaybeSingle(null)),
    })
    const res = await POST(jsonPost({ count: 5 }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_found')
  })

  it('returns 403 when app not active', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        appMaybeSingle({
          monthly_article_limit: 10,
          monthly_articles_generated: 0,
          status: 'paused',
        })
      ),
    })
    const res = await POST(jsonPost({ count: 5 }), ctx())
    expect(res.status).toBe(403)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('app_inactive')
  })

  it('returns 429 when monthly quota exhausted', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        appMaybeSingle({
          monthly_article_limit: 5,
          monthly_articles_generated: 5,
          status: 'active',
        })
      ),
    })
    const res = await POST(jsonPost({ count: 3 }), ctx())
    expect(res.status).toBe(429)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('quota_exhausted')
  })

  it('returns 404 when no keywords match', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return appMaybeSingle({
            monthly_article_limit: 20,
            monthly_articles_generated: 0,
            status: 'active',
          })
        }
        if (table === 'scp_keywords') {
          return kwSelectChain({ data: [], error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(jsonPost({ count: 5 }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('no_keywords')
  })

  it('returns 201 and inserts briefs when eligible', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const kwRow = {
      id: '770e8400-e29b-41d4-a716-446655440001',
      keyword: 'unique bulk keyword',
      intent_type: 'informational',
      cluster_name: 'c1',
      search_volume: 100,
      difficulty: 30,
      opportunity_score: 8,
    }
    const insertedBrief = {
      id: '880e8400-e29b-41d4-a716-446655440002',
      focus_keyword: kwRow.keyword,
      cluster_name: 'c1',
      status: 'pending',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return appMaybeSingle({
            monthly_article_limit: 20,
            monthly_articles_generated: 0,
            status: 'active',
          })
        }
        if (table === 'scp_keywords') {
          return kwSelectChain({ data: [kwRow], error: null })
        }
        if (table === 'scp_briefs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [insertedBrief],
                error: null,
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          return articlesFocusChain([])
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(jsonPost({ count: 5 }), ctx())
    expect(res.status).toBe(201)
    const j = (await res.json()) as {
      created: number
      briefs: typeof insertedBrief[]
    }
    expect(j.created).toBe(1)
    expect(j.briefs).toHaveLength(1)
    expect(j.briefs[0].focus_keyword).toBe('unique bulk keyword')
  })
})
