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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function articlesChain(resolved: { data: unknown[]; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(resolved),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/crawl-health', () => {
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

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      articlesChain({ data: [], error: { message: 'db' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('flags thin content and missing canonical', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      articlesChain({
        data: [
          {
            id: 'a1',
            slug: 'thin',
            title: 'Thin page',
            status: 'draft',
            published_at: null,
            canonical_url: null,
            focus_keyword: null,
            word_count: 100,
            gsc_impressions: 0,
            gsc_avg_position: null,
          },
        ],
        error: null,
      })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      articles_scanned: number
      total_issues: number
      issues: Array<{ issue_type: string; severity: string }>
    }
    expect(j.articles_scanned).toBe(1)
    const types = j.issues.map((i) => i.issue_type)
    expect(types).toContain('thin_content')
    expect(types).toContain('no_focus_keyword')
    expect(types).toContain('no_canonical_url')
  })
})
