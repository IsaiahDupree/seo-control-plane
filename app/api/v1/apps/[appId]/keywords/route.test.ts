import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function listQueryBuilder(result: { data: unknown; error: unknown }) {
  return buildThenableFluentChain(['select', 'eq', 'order', 'range'], result)
}

describe('/api/v1/apps/[appId]/keywords', () => {
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

    it('returns 200 with items from range query', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const row = {
        id: '660e8400-e29b-41d4-a716-446655440000',
        keyword: 'seo tips',
        cluster_name: null,
        status: 'unassigned',
        search_volume: null,
        difficulty: null,
        intent: null,
        priority_score: null,
        is_seed: false,
        article_id: null,
        created_at: '2026-01-01T00:00:00Z',
      }
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          listQueryBuilder({ data: [row], error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      const body = await expectJson(
        res,
        z.object({
          items: z.array(z.object({ keyword: z.string() })),
          limit: z.number(),
        }),
        { status: 200 }
      )
      expect(body.items).toHaveLength(1)
      expect(body.items[0].keyword).toBe('seo tips')
      expect(body.limit).toBeGreaterThanOrEqual(1)
    })

    it('applies status and cluster_name filters from query params', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const builder = listQueryBuilder({ data: [], error: null })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => builder),
      })
      const url = `http://localhost/?status=published&cluster=hub`
      const res = await GET(new NextRequest(url), ctx())
      expect(res.status).toBe(200)
      expect(builder.eq).toHaveBeenCalledWith('app_id', APP_ID)
      expect(builder.eq).toHaveBeenCalledWith('status', 'published')
      expect(builder.eq).toHaveBeenCalledWith('cluster_name', 'hub')
    })

    it('caps limit at 500 for range window', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const builder = listQueryBuilder({ data: [], error: null })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => builder),
      })
      await GET(new NextRequest('http://localhost/?limit=9999&offset=0'), ctx())
      expect(builder.range).toHaveBeenCalledWith(0, 499)
    })

    it('returns 500 when list query fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          listQueryBuilder({ data: null, error: { message: 'down' } })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      await expectJsonError(res, { status: 500, code: 'query_failed' })
    })
  })

  describe('POST', () => {
    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: 'x',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'invalid_json' })
    })

    it('returns 400 when keywords array is empty', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ keywords: [] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'validation_error' })
    })

    it('returns 500 when upsert fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'constraint' },
            }),
          }),
        })),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ keywords: [{ keyword: 'a' }] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 500, code: 'upsert_failed' })
    })

    it('returns 200 after bulk upsert and audit', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  id: '770e8400-e29b-41d4-a716-446655440000',
                  keyword: 'a',
                  cluster_name: null,
                  status: 'unassigned',
                },
              ],
              error: null,
            }),
          }),
        })),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ keywords: [{ keyword: '  a  ' }] }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      const body = await expectJson(
        res,
        z.object({
          upserted: z.number(),
          items: z.array(z.object({ keyword: z.string(), status: z.string() })),
        }),
        { status: 200 }
      )
      expect(body.upserted).toBe(1)
      expect(body.items).toHaveLength(1)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
