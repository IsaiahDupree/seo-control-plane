import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildHeadCountChain,
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqEqSelectSingleChain,
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

import { GET, PATCH } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const REQUEST_ID = 'aa0e8400-e29b-41d4-a716-446655440000'

const requestRow = {
  id: REQUEST_ID,
  app_id: APP_ID,
  requested_count: 5,
  status: 'open',
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
}

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, requestId: REQUEST_ID }) }
}

function clientForGetBriefsCounts(totalError = false, statusErrorAt?: number) {
  let briefsCalls = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_content_requests') {
        return buildSelectEqEqMaybeSingleChain({
          data: requestRow,
          error: null,
        })
      }
      if (table === 'scp_content_briefs') {
        briefsCalls += 1
        if (briefsCalls === 1 && totalError) {
          return buildHeadCountChain({ count: null, error: { message: 'count failed' } })
        }
        if (statusErrorAt !== undefined && briefsCalls === statusErrorAt) {
          return buildHeadCountChain({ count: null, error: { message: 'status count failed' } })
        }
        const counts = [12, 4, 2, 6]
        return buildHeadCountChain({
          count: counts[briefsCalls - 1] ?? 0,
          error: null,
        })
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

describe('/api/v1/apps/[appId]/content/requests/[requestId]', () => {
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

    it('returns 404 when request missing', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((t: string) => {
          if (t === 'scp_content_requests') {
            return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
          }
          throw new Error('unexpected')
        }),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 500 when total briefs count fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue(clientForGetBriefsCounts(true))
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(500)
    })

    it('returns 500 when a status breakdown count fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue(clientForGetBriefsCounts(false, 3))
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(500)
    })

    it('returns 200 with request and briefs breakdown', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue(clientForGetBriefsCounts())
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        request: { id: string }
        briefs: { total: number; by_status: Record<string, number> }
      }
      expect(body.request.id).toBe(REQUEST_ID)
      expect(body.briefs.total).toBe(12)
      expect(body.briefs.by_status.pending).toBe(4)
      expect(body.briefs.by_status.generating).toBe(2)
      expect(body.briefs.by_status.complete).toBe(6)
    })
  })

  describe('PATCH', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(401)
    })

    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: 'x',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 when neither status nor notes provided', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 409 when cancelling non-open request', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({
            data: { id: REQUEST_ID, status: 'processing' },
            error: null,
          })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(409)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('not_cancellable')
    })

    it('returns 200 when cancelling open request', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: { id: REQUEST_ID, status: 'open' },
              error: null,
            })
          }
          return buildUpdateEqEqSelectSingleChain({
            data: { ...requestRow, status: 'cancelled' },
            error: null,
          })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { request: { status: string } }
      expect(body.request.status).toBe('cancelled')
    })

    it('returns 409 when updating notes on non-open request', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({
            data: {
              id: REQUEST_ID,
              status: 'processing',
              notes: null,
            },
            error: null,
          })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(409)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('not_editable')
    })

    it('returns 200 when updating notes on open request', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: REQUEST_ID,
                status: 'open',
                notes: null,
              },
              error: null,
            })
          }
          return buildUpdateEqEqSelectSingleChain({
            data: { ...requestRow, notes: 'updated note' },
            error: null,
          })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'updated note' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { request: { notes: string } }
      expect(body.request.notes).toBe('updated note')
    })
  })
})
