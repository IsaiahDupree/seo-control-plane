import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function freshnessChain(result: { data: unknown; error: unknown }, withClusterEq: boolean) {
  void withClusterEq
  return buildThenableFluentChain(
    ['select', 'eq', 'in', 'not'],
    result
  )
}

describe('GET /api/v1/apps/[appId]/analytics/freshness-distribution', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => freshnessChain({ data: null, error: { message: 'db' } }, false)),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns distribution buckets and needs_refresh list', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })

    const now = Date.now()
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString()

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        freshnessChain(
          {
            data: [
              { id: 'a1', slug: 'one', published_at: daysAgo(10), updated_at: daysAgo(5), cluster_name: 'C1', gsc_avg_position: 5, status: 'published' },
              { id: 'a2', slug: 'two', published_at: daysAgo(400), updated_at: daysAgo(400), cluster_name: 'C1', gsc_avg_position: 12, status: 'ranked' },
            ],
            error: null,
          },
          false
        )
      ),
    })

    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_articles: number
      distribution: Array<{ age_range: string; count: number; stale_count: number }>
      needs_refresh: Array<{ article_id: string }>
      avg_age_days: number | null
    }
    expect(j.total_articles).toBe(2)
    expect(j.distribution.length).toBeGreaterThan(0)
    expect(j.needs_refresh.find((r) => r.article_id === 'a2')).toBeTruthy()
  })

  it('accepts cluster filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => freshnessChain({ data: [], error: null }, true)),
    })
    const res = await GET(new NextRequest('http://localhost/?cluster=C1'), ctx())
    expect(res.status).toBe(200)
  })
})

