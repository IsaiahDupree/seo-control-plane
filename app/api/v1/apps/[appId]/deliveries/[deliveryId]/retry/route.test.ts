import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqEqMaybeSingleChain } from '@/lib/testing/supabase-mocks'

const mockDeliverArticle = vi.fn()

vi.mock('@/lib/deliver', () => ({
  deliverArticle: (...args: unknown[]) => mockDeliverArticle(...args),
}))

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const DELIVERY_ID = '770e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, deliveryId: DELIVERY_ID }) }
}

describe('POST /api/v1/apps/[appId]/deliveries/[deliveryId]/retry', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when delivery query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: null,
          error: { message: 'db' },
        })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 404 when delivery missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when status is not failed', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: DELIVERY_ID,
            article_id: ARTICLE_ID,
            status: 'delivered',
          },
          error: null,
        })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_retryable')
  })

  it('returns 502 when deliverArticle fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: DELIVERY_ID,
            article_id: ARTICLE_ID,
            status: 'failed',
          },
          error: null,
        })
      ),
    })
    mockDeliverArticle.mockResolvedValue({
      success: false,
      error: 'timeout',
      deliveryId: 'new-del-id',
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(502)
    const j = (await res.json()) as {
      error: { code: string; delivery_id?: string }
    }
    expect(j.error.code).toBe('delivery_failed')
    expect(j.error.delivery_id).toBe('new-del-id')
  })

  it('returns 200 when retry succeeds', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: DELIVERY_ID,
            article_id: ARTICLE_ID,
            status: 'failed',
          },
          error: null,
        })
      ),
    })
    mockDeliverArticle.mockResolvedValue({
      success: true,
      deliveryId: '990e8400-e29b-41d4-a716-446655440000',
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      delivery_id: string
      article_id: string
      status: string
    }
    expect(body.status).toBe('delivered')
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(mockDeliverArticle).toHaveBeenCalledWith(ARTICLE_ID, APP_ID)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
