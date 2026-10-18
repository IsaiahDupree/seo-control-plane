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

function reportSelectChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/cannibalization-report', () => {
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

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        reportSelectChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns conflicts including secondary keyword overlap', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = [
      {
        id: '1',
        slug: 'a',
        title: 'A',
        focus_keyword: 'alpha',
        secondary_keywords: ['beta'],
        status: 'published',
        gsc_avg_position: 5,
        gsc_clicks: 10,
      },
      {
        id: '2',
        slug: 'b',
        title: 'B',
        focus_keyword: 'beta',
        secondary_keywords: [] as string[],
        status: 'draft',
        gsc_avg_position: null,
        gsc_clicks: null,
      },
    ]
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => reportSelectChain({ data: rows, error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=10'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_cannibalized_keywords: number
      conflicts: Array<{ keyword: string; competing_articles: number }>
    }
    expect(j.total_cannibalized_keywords).toBeGreaterThan(0)
    const beta = j.conflicts.find((c) => c.keyword === 'beta')
    expect(beta?.competing_articles).toBeGreaterThanOrEqual(2)
  })
})
