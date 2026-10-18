import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqOrderRangeChain } from '@/lib/testing/supabase-mocks'

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
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/events', () => {
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
        buildSelectEqOrderRangeChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 200 with default limit 100', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: 'aa0e8400-e29b-41d4-a716-446655440000',
      article_id: ARTICLE_ID,
      event_name: 'page_view',
      payload: {},
      client_event_id: null,
      occurred_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ event_name: string }>
      limit: number
      has_more: boolean
    }
    expect(body.items[0].event_name).toBe('page_view')
    expect(body.limit).toBe(100)
    expect(body.has_more).toBe(false)
  })

  it('caps limit at 500', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=9999'), ctx())
    expect((await res.json()).limit).toBe(500)
  })

  it('applies filters after range', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    const url = new URL('http://localhost/')
    url.searchParams.set('article_id', ARTICLE_ID)
    url.searchParams.set('event_name', 'click')
    url.searchParams.set('from', '2026-01-01T00:00:00Z')
    url.searchParams.set('to', '2026-01-31T23:59:59Z')
    await GET(new NextRequest(url), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).toHaveBeenCalledWith('article_id', ARTICLE_ID)
    expect(chain.eq).toHaveBeenCalledWith('event_name', 'click')
    expect(chain.gte).toHaveBeenCalledWith('occurred_at', '2026-01-01T00:00:00Z')
    expect(chain.lte).toHaveBeenCalledWith('occurred_at', '2026-01-31T23:59:59Z')
  })
})
