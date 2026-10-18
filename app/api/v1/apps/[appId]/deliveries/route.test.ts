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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/deliveries', () => {
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
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 200 with default limit 30', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: '770e8400-e29b-41d4-a716-446655440000',
      article_id: '660e8400-e29b-41d4-a716-446655440000',
      version: 1,
      status: 'delivered',
      delivery_type: 'webhook',
      attempts: 1,
      last_attempt_at: null,
      delivered_at: '2026-01-01T00:00:00Z',
      error_message: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ status: string }>
      limit: number
      has_more: boolean
    }
    expect(body.items[0].status).toBe('delivered')
    expect(body.limit).toBe(30)
    expect(body.has_more).toBe(false)
  })

  it('caps limit at 100', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=999'), ctx())
    const body = (await res.json()) as { limit: number }
    expect(body.limit).toBe(100)
  })

  it('applies status filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/?status=failed'), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).toHaveBeenCalledWith('status', 'failed')
  })
})
