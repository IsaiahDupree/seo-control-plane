import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
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
const EXP_ID = '660e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'

const expRow = {
  id: EXP_ID,
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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, experimentId: EXP_ID }) }
}

describe('/api/v1/apps/[appId]/experiments/[experimentId]', () => {
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

    it('returns 404 when experiment missing', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 with experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: expRow, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { status: string } }
      expect(body.experiment.status).toBe('running')
    })
  })

  describe('PATCH', () => {
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

    it('returns 400 when body empty', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 200 when concluding experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: EXP_ID,
                article_id: ARTICLE_ID,
                status: 'running',
                winner: null,
                concluded_at: null,
                significance_pct: null,
                control_conversions: 0,
                variant_conversions: 0,
                control_sessions: 0,
                variant_sessions: 0,
              },
              error: null,
            })
          }
          return buildUpdateEqEqSelectSingleChain({
            data: {
              ...expRow,
              status: 'concluded',
              winner: 'variant',
            },
            error: null,
          })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'concluded',
          winner: 'variant',
        }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { status: string } }
      expect(body.experiment.status).toBe('concluded')
    })
  })
})
