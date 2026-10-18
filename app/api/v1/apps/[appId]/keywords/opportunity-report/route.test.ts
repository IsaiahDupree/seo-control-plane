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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function kwChain(result: { data: unknown; error: unknown }) {
  const b = buildSelectEqOrderChain(result)
  ;(b as unknown as { limit?: unknown }).limit = vi.fn().mockReturnValue(b)
  ;(b as unknown as { gte?: unknown }).gte = vi.fn().mockReturnValue(b)
  return b as unknown as {
    select: ReturnType<typeof vi.fn>
    eq: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    gte: ReturnType<typeof vi.fn>
    then: typeof b.then
  }
}

function articlesNotChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/opportunity-report', () => {
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

  it('returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') return kwChain({ data: null, error: { message: 'db' } })
        return articlesNotChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns uncovered opportunities and tier breakdown', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return kwChain({
            data: [
              { id: 'k1', keyword: 'alpha', cluster_name: null, search_volume: 100, opportunity_score: 80, intent_type: 'informational', status: 'active', article_id: null, gsc_position: null },
              { id: 'k2', keyword: 'beta', cluster_name: 'c', search_volume: 10, opportunity_score: 20, intent_type: 'transactional', status: 'active', article_id: null, gsc_position: 12 },
            ],
            error: null,
          })
        }
        return articlesNotChain({
          data: [{ focus_keyword: 'beta', status: 'published' }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=50'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_opportunities: number
      by_tier: Record<string, number>
      opportunities: Array<{ keyword: string; tier: string }>
    }
    expect(j.total_opportunities).toBe(1)
    expect(j.opportunities[0].keyword).toBe('alpha')
    expect(j.opportunities[0].tier).toBe('high')
    expect(j.by_tier.high).toBe(1)
  })
})

