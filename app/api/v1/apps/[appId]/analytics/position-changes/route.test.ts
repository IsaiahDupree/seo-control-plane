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

function gscChain(resolved: { data: unknown[]; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(resolved),
            }),
          }),
        }),
      }),
    })),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/position-changes', () => {
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
      gscChain({ data: [], error: { message: 'timeout' } })
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns position changes when earliest and latest differ', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscChain({
        data: [
          { query: 'widget tips', avg_position: 18, date: '2026-01-05' },
          { query: 'widget tips', avg_position: 8, date: '2026-01-20' },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?days=30&min_change=3'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      changes: Array<{ query: string; direction: string; position_change: number }>
    }
    expect(j.changes.length).toBe(1)
    expect(j.changes[0].query).toBe('widget tips')
    expect(j.changes[0].direction).toBe('improved')
    expect(j.changes[0].position_change).toBe(10)
  })

  it('filters to improved only when direction=up', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      gscChain({
        data: [
          { query: 'up kw', avg_position: 20, date: '2026-01-01' },
          { query: 'up kw', avg_position: 10, date: '2026-01-10' },
          { query: 'down kw', avg_position: 5, date: '2026-01-01' },
          { query: 'down kw', avg_position: 25, date: '2026-01-10' },
        ],
        error: null,
      })
    )
    const res = await GET(
      new NextRequest('http://localhost/?min_change=3&direction=up'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { changes: Array<{ query: string }> }
    expect(j.changes.every((c) => c.query === 'up kw')).toBe(true)
  })
})
