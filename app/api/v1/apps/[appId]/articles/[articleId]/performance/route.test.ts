import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildSelectEqOrderRangeChain,
} from '@/lib/testing/supabase-mocks'

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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/performance', () => {
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
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 500 when daily performance query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 's',
              title: 'T',
              published_at: null,
              gsc_avg_position: 5,
              gsc_clicks: 1,
              gsc_impressions: 10,
              gsc_ctr: 0.1,
            },
            error: null,
          })
        }
        if (table === 'scp_article_performance') {
          return buildSelectEqOrderRangeChain({
            data: null,
            error: { message: 'perf fail' },
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns totals and daily rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const dailyRow = {
      date: '2026-01-10',
      sessions: 2,
      pageviews: 4,
      avg_scroll_depth: null,
      reads_complete: 0,
      cta_clicks: 0,
      conversions: 0,
      avg_position: 8,
      impressions: 100,
      clicks: 3,
      ctr: 0.03,
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 'slug',
              title: 'Title',
              published_at: '2026-01-01',
              gsc_avg_position: 4.5,
              gsc_clicks: 20,
              gsc_impressions: 200,
              gsc_ctr: 0.1,
            },
            error: null,
          })
        }
        if (table === 'scp_article_performance') {
          return buildSelectEqOrderRangeChain({
            data: [dailyRow],
            error: null,
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(
      new NextRequest(
        'http://localhost/?since=2026-01-01&until=2026-01-31'
      ),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      period: { since: string; until: string }
      totals: { sessions: number; pageviews: number }
      daily: typeof dailyRow[]
      gsc_current: { avg_position: number }
    }
    expect(j.period.since).toBe('2026-01-01')
    expect(j.period.until).toBe('2026-01-31')
    expect(j.totals.sessions).toBe(2)
    expect(j.totals.pageviews).toBe(4)
    expect(j.daily).toHaveLength(1)
    expect(j.gsc_current.avg_position).toBe(4.5)
  })
})
