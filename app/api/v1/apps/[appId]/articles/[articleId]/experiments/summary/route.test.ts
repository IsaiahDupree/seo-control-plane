import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqOrderChain } from '@/lib/testing/supabase-mocks'

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

describe('GET /api/v1/apps/[appId]/articles/[articleId]/experiments/summary', () => {
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

  it('returns 500 when experiments query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({
          data: null,
          error: { message: 'db' },
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns empty summary when no experiments', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({ data: [], error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      experiment_count: number
      overall_ctr: number | null
      experiments: unknown[]
    }
    expect(j.experiment_count).toBe(0)
    expect(j.overall_ctr).toBeNull()
    expect(j.experiments).toEqual([])
  })

  it('aggregates active, concluded, and winner', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = [
      {
        id: 'e1',
        variant_name: 'A',
        status: 'running',
        impressions: 100,
        clicks: 5,
        ctr: 0.05,
        created_at: '2026-02-01',
        concluded_at: null,
        winner: false,
      },
      {
        id: 'e2',
        variant_name: 'B',
        status: 'concluded',
        impressions: 200,
        clicks: 20,
        ctr: 0.1,
        created_at: '2026-01-01',
        concluded_at: '2026-01-15',
        winner: true,
      },
    ]
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({ data: rows, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      active_count: number
      concluded_count: number
      total_impressions: number
      total_clicks: number
      overall_ctr: number | null
      winning_variant: { id: string; variant_name: string } | null
    }
    expect(j.active_count).toBe(1)
    expect(j.concluded_count).toBe(1)
    expect(j.total_impressions).toBe(300)
    expect(j.total_clicks).toBe(25)
    expect(j.overall_ctr).not.toBeNull()
    expect(j.winning_variant?.id).toBe('e2')
  })
})
