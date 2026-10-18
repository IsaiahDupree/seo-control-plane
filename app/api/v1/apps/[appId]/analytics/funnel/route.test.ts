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

function eventsChain(resolved: { data: unknown[]; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(resolved),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/funnel', () => {
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
    mockCreateAdminClient.mockReturnValue(
      eventsChain({ data: [], error: { message: 'timeout' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns funnel stages for events in range', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      eventsChain({
        data: [
          { event_name: 'article_viewed', article_id: 'x1' },
          { event_name: 'page_view', article_id: 'x2' },
          { event_name: 'scroll_50', article_id: 'x1' },
          { event_name: 'cta_clicked', article_id: 'x1' },
          { event_name: 'paid', article_id: 'x3' },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?since=2026-01-01&until=2026-01-31'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      period: { since: string; until: string }
      funnel: Array<{ stage: string; event_count: number }>
      overall_conversion_rate: string
    }
    expect(j.period.since).toBe('2026-01-01')
    expect(j.period.until).toBe('2026-01-31')
    const views = j.funnel.find((s) => s.stage === 'views')
    const converted = j.funnel.find((s) => s.stage === 'converted')
    expect(views?.event_count).toBe(2)
    expect(converted?.event_count).toBe(1)
    expect(j.overall_conversion_rate).not.toBe('0%')
  })
})
