import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqSingleChain,
  buildSelectEqOrderChain,
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
const EXP_ID = '770e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/experiments', () => {
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

  it('returns 500 when query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 200 with experiments and stats', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: EXP_ID,
      app_id: APP_ID,
      article_id: ARTICLE_ID,
      variant_type: 'title',
      control_value: 'A',
      variant_value: 'B',
      status: 'running',
      control_conversions: 10,
      variant_conversions: 12,
      control_sessions: 100,
      variant_sessions: 100,
      significance_pct: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      experiments: Array<{ id: string; stats: { control_cr: number } }>
    }
    expect(body.experiments).toHaveLength(1)
    expect(body.experiments[0].id).toBe(EXP_ID)
    expect(body.experiments[0].stats.control_cr).toBe(0.1)
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/experiments', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          variant_type: 'title',
          control_value: 'A',
          variant_value: 'B',
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', { method: 'POST', body: 'x' }),
      ctx()
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when article not found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({ data: null, error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          variant_type: 'title',
          control_value: 'A',
          variant_value: 'B',
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(404)
  })

  it('returns 409 when a running experiment exists for variant_type', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let experimentsCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({
            data: { id: ARTICLE_ID },
            error: null,
          })
        }
        if (t === 'scp_experiments') {
          experimentsCalls += 1
          if (experimentsCalls === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: 'existing' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          throw new Error('unexpected second experiments call')
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          variant_type: 'title',
          control_value: 'A',
          variant_value: 'B',
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(409)
  })

  it('returns 201 and creates experiment', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const created = {
      id: EXP_ID,
      app_id: APP_ID,
      article_id: ARTICLE_ID,
      variant_type: 'title',
      control_value: 'A',
      variant_value: 'B',
      status: 'running',
    }
    let experimentsCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({
            data: { id: ARTICLE_ID },
            error: null,
          })
        }
        if (t === 'scp_experiments') {
          experimentsCalls += 1
          if (experimentsCalls === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: created, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          variant_type: 'title',
          control_value: 'A',
          variant_value: 'B',
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { experiment: { id: string } }
    expect(body.experiment.id).toBe(EXP_ID)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
