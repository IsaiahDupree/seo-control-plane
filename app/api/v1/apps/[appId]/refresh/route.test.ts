import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
import { buildRefreshListChain, buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

const mockEnqueueStaleArticles = vi.fn()

vi.mock('@/lib/refresh-queue', () => ({
  enqueueStaleArticles: (...args: unknown[]) => mockEnqueueStaleArticles(...args),
}))

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

describe('/api/v1/apps/[appId]/refresh', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      await expectJsonError(res, { status: 401, code: 'unauthorized' })
    })

    it('returns 500 when query errors', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildRefreshListChain({ data: null, error: { message: 'db' }, count: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      await expectJsonError(res, { status: 500, code: 'query_failed' })
    })

    it('defaults to status queued when no filter', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildRefreshListChain({
        data: [],
        error: null,
        count: 0,
      })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
      await GET(new NextRequest('http://localhost/'), ctx())
      expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
      expect(chain.eq).toHaveBeenCalledWith('status', 'queued')
    })

    it('does not force queued when all_statuses=1', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildRefreshListChain({ data: [], error: null, count: 0 })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
      await GET(new NextRequest('http://localhost/?all_statuses=1'), ctx())
      expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
      expect(chain.eq).not.toHaveBeenCalledWith('status', 'queued')
    })

    it('uses explicit status when provided', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildRefreshListChain({ data: [], error: null, count: 0 })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
      await GET(new NextRequest('http://localhost/?status=completed'), ctx())
      expect(chain.eq).toHaveBeenCalledWith('status', 'completed')
    })

    it('returns total from count', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildRefreshListChain({
            data: [{ id: 'x', article_id: ARTICLE_ID }],
            error: null,
            count: 42,
          })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      const body = await expectJson(
        res,
        z.object({
          total: z.number(),
          items: z.array(z.unknown()),
          limit: z.number(),
          offset: z.number(),
          has_more: z.boolean(),
        }),
        { status: 200 }
      )
      expect(body.total).toBe(42)
      expect(body.items).toHaveLength(1)
    })
  })

  describe('POST', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 401, code: 'unauthorized' })
    })

    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'invalid_json' })
    })

    it('returns 400 when stale_days out of range', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ stale_days: 0 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'validation_error' })
    })

    it('returns 400 article_mismatch when id not owned', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
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
      const otherId = '770e8400-e29b-41d4-a716-446655440000'
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ article_ids: [ARTICLE_ID, otherId] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'article_mismatch' })
    })

    it('returns 200 manual mode when enqueueing article_ids', async () => {
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
          if (table === 'scp_refresh_queue') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  then: buildThenableFluentChain([], {
                    data: [{ id: 'job-1' }],
                    error: null,
                  }).then,
                }),
              }),
            }
          }
          throw new Error(`unexpected ${table}`)
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ article_ids: [ARTICLE_ID] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      const body = await expectJson(
        res,
        z.object({
          mode: z.literal('manual'),
          enqueued: z.number(),
        }),
        { status: 200 }
      )
      expect(body.mode).toBe('manual')
      expect(body.enqueued).toBe(1)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })

    it('returns 200 auto mode using enqueueStaleArticles', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      mockEnqueueStaleArticles.mockResolvedValue({ enqueued: 3, skipped: 1 })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ stale_days: 30 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      const body = await expectJson(
        res,
        z.object({
          mode: z.literal('auto'),
          enqueued: z.number(),
          skipped: z.number(),
        }),
        { status: 200 }
      )
      expect(body.mode).toBe('auto')
      expect(body.enqueued).toBe(3)
      expect(body.skipped).toBe(1)
      expect(mockEnqueueStaleArticles).toHaveBeenCalledWith(APP_ID, 30)
    })
  })
})
