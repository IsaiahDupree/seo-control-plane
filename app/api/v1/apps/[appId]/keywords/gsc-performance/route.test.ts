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

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/keywords/gsc-performance', () => {
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

  it('returns 503 when table is missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderLimitChain({
          data: null,
          error: { code: '42P01', message: 'relation does not exist' },
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('table_missing')
  })

  it('returns 503 when error message mentions missing relation', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderLimitChain({
          data: null,
          error: { message: 'scp_gsc_performance does not exist' },
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(503)
  })

  it('returns 500 on other query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderLimitChain({ data: null, error: { message: 'timeout' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 200 with items', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: '1',
      gsc_query: 'hello',
      clicks: 1,
      impressions: 10,
      ctr: 0.1,
      position: 2.5,
      date: '2026-04-01',
      created_at: '2026-04-01T12:00:00Z',
    }
    const chain = buildSelectEqOrderLimitChain({ data: [row], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].gsc_query).toBe('hello')
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.limit).toHaveBeenCalledWith(100)
  })

  it('applies from and to query params', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderLimitChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    const url = 'http://localhost/?from=2026-01-01&to=2026-03-01&limit=50'
    await GET(new NextRequest(url), ctx())
    expect(chain.gte).toHaveBeenCalledWith('date', '2026-01-01')
    expect(chain.lte).toHaveBeenCalledWith('date', '2026-03-01')
    expect(chain.limit).toHaveBeenCalledWith(50)
  })
})
