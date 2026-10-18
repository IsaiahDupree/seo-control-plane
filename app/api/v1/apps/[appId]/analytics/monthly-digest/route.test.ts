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

function headCountChain(count: number, error: unknown = null) {
  const res = { count, error }
  return buildThenableFluentChain(['select', 'eq', 'gte', 'lte'], res)
}

function gscRowsChain(data: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    }),
  }
}

function topArticlesChain(data: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data, error }),
            }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/monthly-digest', () => {
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

  it('returns 400 invalid_year for out-of-range year', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/?year=1900&month=1'), ctx())
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_year')
  })

  it('returns 400 invalid_month for out-of-range month', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/?year=2026&month=13'), ctx())
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_month')
  })

  it('returns digest with counts and gsc aggregates', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          // first call is head count; second call is top articles list
          return {
            select: vi.fn((_: unknown, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) return headCountChain(2)
              return topArticlesChain([
                { id: 'a1', slug: 'one', title: 'One', gsc_clicks: 10, gsc_avg_position: 5, focus_keyword: 'alpha' },
              ]).select()
            }),
          }
        }
        if (table === 'scp_deliveries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(headCountChain(3)),
            }),
          }
        }
        if (table === 'scp_keywords') return headCountChain(7)
        if (table === 'scp_briefs') return headCountChain(4)
        if (table === 'scp_gsc_performance') return gscRowsChain([{ impressions: 100, clicks: 10, avg_position: 7 }])
        throw new Error(`unexpected table ${table}`)
      }),
    })

    const res = await GET(new NextRequest('http://localhost/?year=2026&month=1'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      period: { year: number; month: number }
      gsc: { total_impressions: number; total_clicks: number; avg_position: number | null; ctr: number | null }
      articles: { published: number; top_articles: unknown[] }
      deliveries: { delivered: number; failed: number; success_rate: number | null }
      keywords: { added: number }
      briefs: { created: number }
    }
    expect(j.period.year).toBe(2026)
    expect(j.period.month).toBe(1)
    expect(j.articles.published).toBe(2)
    expect(j.keywords.added).toBe(7)
    expect(j.briefs.created).toBe(4)
    expect(j.gsc.total_impressions).toBe(100)
    expect(j.gsc.total_clicks).toBe(10)
    expect(j.articles.top_articles.length).toBe(1)
  })
})

