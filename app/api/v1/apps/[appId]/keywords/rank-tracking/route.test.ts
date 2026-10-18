import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqOrderLimitChain } from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/keywords/rank-tracking', () => {
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

    it('returns 500 when query fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildSelectEqOrderLimitChain({ data: null, error: { message: 'db' } })
      ;(chain as unknown as { ilike?: unknown }).ilike = vi.fn().mockReturnValue(chain)
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => chain),
      })
      const res = await GET(new NextRequest('http://localhost/?keyword=alpha'), ctx())
      expect(res.status).toBe(500)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
    })

    it('returns tracking rows and latest_by_keyword', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const chain = buildSelectEqOrderLimitChain({
        data: [
          { query: 'alpha', avg_position: 5, page_url: 'https://x.com/a', date: '2026-01-02', impressions: 10, clicks: 1, ctr: 0.1 },
          { query: 'alpha', avg_position: 7, page_url: 'https://x.com/a', date: '2026-01-01', impressions: 10, clicks: 1, ctr: 0.1 },
          { query: 'beta', avg_position: 3, page_url: 'https://x.com/b', date: '2026-01-02', impressions: 10, clicks: 1, ctr: 0.1 },
        ],
        error: null,
      })
      ;(chain as unknown as { ilike?: unknown }).ilike = vi.fn().mockReturnValue(chain)
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => chain),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const j = (await res.json()) as { total: number; latest_by_keyword: Array<{ query: string }> }
      expect(j.total).toBe(3)
      expect(j.latest_by_keyword.map((x) => x.query).sort()).toEqual(['alpha', 'beta'])
    })
  })

  describe('POST', () => {
    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const res = await POST(
        new NextRequest('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        }),
        ctx()
      )
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_json')
    })

    it('upserts rows and returns ingested count', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const upsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: '1', query: 'alpha', avg_position: 5, date: '2026-01-02' }],
          error: null,
        }),
      })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({ upsert })),
      })
      const res = await POST(
        new NextRequest('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: [{ keyword: 'Alpha', position: 5, date: '2026-01-02' }],
          }),
        }),
        ctx()
      )
      expect(res.status).toBe(200)
      const j = (await res.json()) as { ingested: number; total: number }
      expect(j.total).toBe(1)
      expect(j.ingested).toBe(1)
      expect(upsert).toHaveBeenCalled()
    })
  })
})

