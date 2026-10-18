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

function serpChain(result: { data: unknown; error: unknown }, withDomainFilter = false) {
  const terminal = buildSelectEqOrderChain(result)
  // extend with lte + limit and optional eq-after-limit
  ;(terminal as unknown as { lte?: unknown }).lte = vi.fn().mockReturnValue(terminal)
  ;(terminal as unknown as { limit?: unknown }).limit = vi.fn().mockReturnValue(
    withDomainFilter
      ? { eq: vi.fn().mockReturnValue(terminal) }
      : terminal
  )
  return {
    select: terminal.select,
    eq: terminal.eq,
    lte: (terminal as unknown as { lte: unknown }).lte as unknown as ReturnType<typeof vi.fn>,
    order: terminal.order,
    limit: (terminal as unknown as { limit: unknown }).limit as unknown as ReturnType<typeof vi.fn>,
    then: terminal.then,
  }
}

function articlesChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/gap-analysis', () => {
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

  it('returns 500 when serp query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_competitor_serps') {
          return serpChain({ data: null, error: { message: 'db' } })
        }
        if (table === 'scp_keywords') {
          return buildSelectEqOrderChain({ data: [], error: null })
        }
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns gaps and summary', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_competitor_serps') {
          return serpChain({
            data: [
              {
                keyword: 'alpha',
                competitor_domain: 'rival.com',
                rank_position: 3,
                page_url: 'https://rival.com/a',
                page_title: 'A',
                fetched_at: '2026-01-01',
              },
            ],
            error: null,
          })
        }
        if (table === 'scp_keywords') {
          return buildSelectEqOrderChain({
            data: [
              {
                keyword: 'alpha',
                status: 'active',
                opportunity_score: 50,
                search_volume: 100,
                difficulty: 20,
                intent_type: 'informational',
              },
            ],
            error: null,
          })
        }
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { summary: { gaps: number }; gaps: Array<{ keyword: string }> }
    expect(j.summary.gaps).toBe(1)
    expect(j.gaps[0].keyword).toBe('alpha')
  })

  it('applies competitor_domain filter after limit when domain set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_competitor_serps') {
          return serpChain({ data: [], error: null }, true)
        }
        if (table === 'scp_keywords') {
          return buildSelectEqOrderChain({ data: [], error: null })
        }
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?domain=rival.com'), ctx())
    expect(res.status).toBe(200)
  })
})

