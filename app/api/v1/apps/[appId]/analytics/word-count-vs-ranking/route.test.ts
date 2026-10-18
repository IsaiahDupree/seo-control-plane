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

function scatterChain(result: { data: unknown; error: unknown }, withClusterEq: boolean, withIntentEq: boolean) {
  // The route conditionally calls extra `.eq()` for filters. Returning self for `.eq()`
  // already handles that, but keeping args to make intent explicit.
  void withClusterEq
  void withIntentEq
  return buildThenableFluentChain(
    ['select', 'eq', 'in', 'not', 'order', 'limit'],
    result
  )
}

describe('GET /api/v1/apps/[appId]/analytics/word-count-vs-ranking', () => {
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
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => scatterChain({ data: null, error: { message: 'db' } }, false, false)),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns bucket summary and scatter rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        scatterChain(
          {
            data: [
              { id: 'a1', slug: 'one', cluster_name: 'C1', intent_type: 'informational', word_count: 800, gsc_avg_position: 5, gsc_clicks: 10 },
              { id: 'a2', slug: 'two', cluster_name: 'C1', intent_type: 'informational', word_count: 1200, gsc_avg_position: 7, gsc_clicks: 5 },
              { id: 'a3', slug: 'three', cluster_name: 'C2', intent_type: 'commercial', word_count: 3000, gsc_avg_position: 15, gsc_clicks: 1 },
              { id: 'a4', slug: 'four', cluster_name: null, intent_type: null, word_count: 400, gsc_avg_position: 25, gsc_clicks: 0 },
              { id: 'a5', slug: 'five', cluster_name: 'C2', intent_type: 'commercial', word_count: 600, gsc_avg_position: 9, gsc_clicks: 3 },
            ],
            error: null,
          },
          false,
          false
        )
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      articles_analyzed: number
      bucket_summary: Array<{ word_count_range: string; article_count: number; avg_position: number | null; total_clicks: number }>
      scatter: Array<{ article_id: string; word_count: number; avg_position: number }>
      correlation_note: string
    }
    expect(j.articles_analyzed).toBe(5)
    expect(j.bucket_summary.length).toBeGreaterThan(0)
    expect(j.scatter.length).toBe(5)
    expect(typeof j.correlation_note).toBe('string')
  })

  it('accepts cluster and intent filters', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => scatterChain({ data: [], error: null }, true, true)),
    })
    const res = await GET(
      new NextRequest('http://localhost/?cluster=C1&intent_type=informational'),
      ctx()
    )
    expect(res.status).toBe(200)
  })
})

