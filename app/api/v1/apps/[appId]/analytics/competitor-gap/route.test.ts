import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

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

function ourKeywordsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function competitorSerpChain(result: { data: unknown; error: unknown }, domainFilter: boolean) {
  const base = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue(
          domainFilter
            ? { eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(result) }) }
            : { limit: vi.fn().mockResolvedValue(result) }
        ),
      }),
    }),
  }
  return base
}

describe('GET /api/v1/apps/[appId]/analytics/competitor-gap', () => {
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

  it('returns 500 when our keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') return ourKeywordsChain({ data: null, error: { message: 'db' } })
        return competitorSerpChain({ data: [], error: null }, false)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns gaps for keywords we do not track or outranked', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let kwFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          kwFrom += 1
          if (kwFrom === 1) {
            return ourKeywordsChain({
              data: [{ id: 'k1', keyword: 'alpha', gsc_position: 50, status: 'active' }],
              error: null,
            })
          }
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'k2', keyword: 'beta', search_volume: 100, cluster_name: null }],
                error: null,
              }),
            }),
          }
        }
        return competitorSerpChain(
          { data: [{ keyword_id: 'k2', domain: 'rival.com', position: 3 }], error: null },
          false
        )
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { total_gaps: number; gaps: Array<{ keyword: string; gap_type: string }> }
    expect(j.total_gaps).toBe(1)
    expect(j.gaps[0].keyword).toBe('beta')
    expect(['not_tracked', 'outranked']).toContain(j.gaps[0].gap_type)
  })

  it('applies domain filter in serp query when domain provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') return ourKeywordsChain({ data: [], error: null })
        return competitorSerpChain({ data: [], error: null }, true)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?domain=rival.com'), ctx())
    expect(res.status).toBe(200)
  })
})

