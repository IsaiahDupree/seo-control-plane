import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqOrderRangeChain, buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

const validRow = {
  article_id: ARTICLE_ID,
  date: '2026-01-15',
  sessions: 10,
  pageviews: 20,
  reads_complete: 0,
  cta_clicks: 0,
  conversions: 0,
  attributed_revenue_usd: 0,
  impressions: 100,
  clicks: 5,
}

describe('/api/v1/apps/[appId]/article-performance', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(401)
    })

    it('returns 500 when query errors', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqOrderRangeChain({ data: null, error: { message: 'db' } })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(500)
    })

    it('returns 200 with default limit 60', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const row = {
        id: 'bb0e8400-e29b-41d4-a716-446655440000',
        article_id: ARTICLE_ID,
        date: '2026-01-10',
        sessions: 1,
        pageviews: 2,
        avg_scroll_depth: null,
        reads_complete: 0,
        cta_clicks: 0,
        conversions: 0,
        attributed_revenue_usd: 0,
        avg_position: null,
        impressions: 0,
        clicks: 0,
        ctr: null,
        created_at: '2026-01-01T00:00:00Z',
      }
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        items: unknown[]
        limit: number
        has_more: boolean
      }
      expect(body.items).toHaveLength(1)
      expect(body.limit).toBe(60)
      expect(body.has_more).toBe(false)
    })

    it('caps limit at 200', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
      })
      const res = await GET(new NextRequest('http://localhost/?limit=999'), ctx())
      expect((await res.json()).limit).toBe(200)
    })

    it('applies article_id and date range after range', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
      const url =
        'http://localhost/?article_id=' +
        ARTICLE_ID +
        '&from=2026-01-01&to=2026-01-31'
      await GET(new NextRequest(url), ctx())
      expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
      expect(chain.eq).toHaveBeenCalledWith('article_id', ARTICLE_ID)
      expect(chain.gte).toHaveBeenCalledWith('date', '2026-01-01')
      expect(chain.lte).toHaveBeenCalledWith('date', '2026-01-31')
    })
  })

  describe('POST', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [validRow] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(401)
    })

    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: 'x',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('invalid_json')
    })

    it('returns 400 when rows empty', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 article_mismatch when article not owned', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const otherId = '770e8400-e29b-41d4-a716-446655440000'
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                then: buildThenableFluentChain([], {
                  data: [{ id: ARTICLE_ID }],
                  error: null,
                }).then,
              }),
            }),
          }),
        })),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          rows: [
            validRow,
            { ...validRow, article_id: otherId, date: '2026-01-16' },
          ],
        }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('article_mismatch')
    })

    it('returns 500 when ownership query fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                then: buildThenableFluentChain([], {
                  data: null,
                  error: { message: 'rls' },
                }).then,
              }),
            }),
          }),
        })),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [validRow] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(500)
    })

    it('returns 500 when upsert fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'scp_articles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    then: buildThenableFluentChain([], {
                      data: [{ id: ARTICLE_ID }],
                      error: null,
                    }).then,
                  }),
                }),
              }),
            }
          }
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                then: buildThenableFluentChain([], {
                  data: null,
                  error: { message: 'conflict' },
                }).then,
              }),
            }),
          }
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [validRow] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(500)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('upsert_failed')
    })

    it('returns 200 with upserted count', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'scp_articles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockReturnValue({
                    then: buildThenableFluentChain([], {
                      data: [{ id: ARTICLE_ID }],
                      error: null,
                    }).then,
                  }),
                }),
              }),
            }
          }
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                then: buildThenableFluentChain([], {
                  data: [{ id: 'perf-1', article_id: ARTICLE_ID, date: '2026-01-15' }],
                  error: null,
                }).then,
              }),
            }),
          }
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [validRow] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { upserted: number }
      expect(body.upserted).toBe(1)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
