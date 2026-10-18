import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildSelectEqOrderRangeChain,
} from '@/lib/testing/supabase-mocks'

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

describe('/api/v1/apps/[appId]/experiments', () => {
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

    it('returns 200 with default limit 40', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const row = {
        id: '770e8400-e29b-41d4-a716-446655440000',
        article_id: ARTICLE_ID,
        variant_type: 'title',
        control_value: 'A',
        variant_value: 'B',
        status: 'running',
        winner: null,
        started_at: null,
        concluded_at: null,
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
        significance_pct: null,
        created_at: '2026-01-01T00:00:00Z',
      }
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { items: unknown[]; limit: number }
      expect(body.items).toHaveLength(1)
      expect(body.limit).toBe(40)
    })

    it('applies article_id and status after range', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
      mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
      const url = `http://localhost/?article_id=${ARTICLE_ID}&status=running`
      await GET(new NextRequest(url), ctx())
      expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
      expect(chain.eq).toHaveBeenCalledWith('article_id', ARTICLE_ID)
      expect(chain.eq).toHaveBeenCalledWith('status', 'running')
    })

    it('caps limit at 100', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
      })
      const res = await GET(new NextRequest('http://localhost/?limit=500'), ctx())
      expect((await res.json()).limit).toBe(100)
    })
  })

  describe('POST', () => {
    const validBody = {
      article_id: ARTICLE_ID,
      variant_type: 'title',
      control_value: 'Old title',
      variant_value: 'New title',
    }

    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify(validBody),
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
    })

    it('returns 404 when article not in app', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(404)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('article_not_found')
    })

    it('returns 200 and creates experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const expRow = {
        id: '880e8400-e29b-41d4-a716-446655440000',
        article_id: ARTICLE_ID,
        variant_type: 'title',
        control_value: 'Old title',
        variant_value: 'New title',
        status: 'running',
        winner: null,
        started_at: null,
        concluded_at: null,
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
        significance_pct: null,
        created_at: '2026-01-01T00:00:00Z',
      }
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: { id: ARTICLE_ID },
              error: null,
            })
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: expRow, error: null }),
              }),
            }),
          }
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { id: string } }
      expect(body.experiment.id).toBe(expRow.id)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
