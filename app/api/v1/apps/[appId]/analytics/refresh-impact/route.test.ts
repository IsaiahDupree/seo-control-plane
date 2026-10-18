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

function refreshQueueChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(result),
            }),
          }),
        }),
      }),
    }),
  }
}

function articlesInChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/refresh-impact', () => {
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

  it('returns 500 when refresh queue query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_refresh_queue') return refreshQueueChain({ data: null, error: { message: 'db' } })
        return articlesInChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns empty results when no refreshes', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const fromMock = vi.fn((table: string) => {
      if (table === 'scp_refresh_queue') return refreshQueueChain({ data: [], error: null })
      throw new Error('articles query should not run')
    })
    mockCreateAdminClient.mockReturnValue({ from: fromMock })
    const res = await GET(new NextRequest('http://localhost/?days=30&limit=10'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { refreshes_analyzed: number; results: unknown[] }
    expect(j.refreshes_analyzed).toBe(0)
    expect(j.results).toEqual([])
  })

  it('includes article slug/title for refreshed items when found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_refresh_queue') {
          return refreshQueueChain({
            data: [
              { article_id: 'a1', queued_at: '2026-01-01', completed_at: '2026-01-02', status: 'delivered' },
            ],
            error: null,
          })
        }
        return articlesInChain({
          data: [{ id: 'a1', slug: 'one', title: 'One', gsc_avg_position: 5, gsc_clicks: 10, updated_at: '2026-01-03' }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?days=90&limit=30'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { refreshes_analyzed: number; results: Array<{ article_id: string; slug: string | null; title: string | null }> }
    expect(j.refreshes_analyzed).toBe(1)
    expect(j.results[0].slug).toBe('one')
    expect(j.results[0].title).toBe('One')
  })
})

