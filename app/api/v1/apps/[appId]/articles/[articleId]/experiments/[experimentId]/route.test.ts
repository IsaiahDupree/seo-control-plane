import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqEqSingleChain,
  buildUpdateEqSelectSingleChain,
} from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()
const mockConcludeExperiment = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

vi.mock('@/lib/experiments', async () => {
  const actual = await vi.importActual<typeof import('@/lib/experiments')>('@/lib/experiments')
  return {
    ...actual,
    concludeExperiment: (...args: unknown[]) => mockConcludeExperiment(...args),
  }
})

import { GET, PATCH } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'
const EXP_ID = '770e8400-e29b-41d4-a716-446655440000'

const expRow = {
  id: EXP_ID,
  app_id: APP_ID,
  article_id: ARTICLE_ID,
  variant_type: 'title',
  control_value: 'A',
  variant_value: 'B',
  status: 'running',
  winner: null,
  control_conversions: 10,
  variant_conversions: 12,
  control_sessions: 100,
  variant_sessions: 100,
  significance_pct: null,
  created_at: '2026-01-01T00:00:00Z',
}

function ctx() {
  return {
    params: Promise.resolve({
      appId: APP_ID,
      articleId: ARTICLE_ID,
      experimentId: EXP_ID,
    }),
  }
}

describe('/api/v1/apps/[appId]/articles/[articleId]/experiments/[experimentId]', () => {
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
          buildSelectEqEqEqSingleChain({ data: null, error: { message: 'missing' } })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 with experiment and stats', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqEqSingleChain({ data: expRow, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        experiment: { id: string; stats: { control_cr: number } }
      }
      expect(body.experiment.id).toBe(EXP_ID)
      expect(body.experiment.stats.control_cr).toBe(0.1)
    })
  })

  describe('PATCH', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', { method: 'PATCH', body: '{}' }),
        ctx()
      )
      expect(res.status).toBe(401)
    })

    it('returns 400 on invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: 'not-json',
        }),
        ctx()
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when no updates provided', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqEqSingleChain({
            data: {
              id: EXP_ID,
              status: 'running',
              control_conversions: 0,
              variant_conversions: 0,
              control_sessions: 0,
              variant_sessions: 0,
            },
            error: null,
          })
        ),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({}),
        }),
        ctx()
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('no_updates')
    })

    it('returns 200 when concluding via concludeExperiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockConcludeExperiment.mockResolvedValue({ ok: true, winner: 'variant' })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'conclude', apply_winner: false }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; winner: string }
      expect(body.ok).toBe(true)
      expect(body.winner).toBe('variant')
      expect(mockConcludeExperiment).toHaveBeenCalledWith(EXP_ID, APP_ID, false)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })

    it('returns 400 when concludeExperiment fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockConcludeExperiment.mockResolvedValue({
        ok: false,
        winner: null,
        error: 'not found',
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'conclude' }),
        }),
        ctx()
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('conclude_failed')
    })

    it('returns 404 when experiment missing for patch', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqEqSingleChain({ data: null, error: null })
        ),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'pause' }),
        }),
        ctx()
      )
      expect(res.status).toBe(404)
    })

    it('returns 200 when pausing experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const verifyRow = {
        id: EXP_ID,
        status: 'running',
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
      }
      const updated = { ...expRow, status: 'paused' }
      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildSelectEqEqEqSingleChain({
              data: verifyRow,
              error: null,
            })
          }
          return buildUpdateEqSelectSingleChain({ data: updated, error: null })
        }),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'pause' }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { status: string } }
      expect(body.experiment.status).toBe('paused')
    })

    it('returns 400 on invalid action enum', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'not_valid' }),
        }),
        ctx()
      )
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('validation_error')
    })

    it('returns 200 when cancelling experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const verifyRow = {
        id: EXP_ID,
        status: 'running',
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
      }
      const updated = { ...expRow, status: 'cancelled' }
      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildSelectEqEqEqSingleChain({
              data: verifyRow,
              error: null,
            })
          }
          return buildUpdateEqSelectSingleChain({ data: updated, error: null })
        }),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'cancel' }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { status: string } }
      expect(body.experiment.status).toBe('cancelled')
    })

    it('returns 200 when resuming experiment', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const verifyRow = {
        id: EXP_ID,
        status: 'paused',
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
      }
      const updated = { ...expRow, status: 'running' }
      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildSelectEqEqEqSingleChain({
              data: verifyRow,
              error: null,
            })
          }
          return buildUpdateEqSelectSingleChain({ data: updated, error: null })
        }),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'resume' }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { status: string } }
      expect(body.experiment.status).toBe('running')
    })

    it('returns 200 when patching counters only', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const verifyRow = {
        id: EXP_ID,
        status: 'running',
        control_conversions: 1,
        variant_conversions: 2,
        control_sessions: 10,
        variant_sessions: 10,
      }
      const updated = { ...expRow, control_conversions: 5 }
      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildSelectEqEqEqSingleChain({
              data: verifyRow,
              error: null,
            })
          }
          return buildUpdateEqSelectSingleChain({ data: updated, error: null })
        }),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ control_conversions: 5 }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as { experiment: { control_conversions: number } }
      expect(body.experiment.control_conversions).toBe(5)
    })

    it('returns 500 when update fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const verifyRow = {
        id: EXP_ID,
        status: 'running',
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
      }
      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildSelectEqEqEqSingleChain({
              data: verifyRow,
              error: null,
            })
          }
          return buildUpdateEqSelectSingleChain({
            data: null,
            error: { message: 'row locked' },
          })
        }),
      })
      const res = await PATCH(
        new NextRequest('http://localhost/', {
          method: 'PATCH',
          body: JSON.stringify({ action: 'pause' }),
        }),
        ctx()
      )
      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('update_failed')
    })
  })
})
