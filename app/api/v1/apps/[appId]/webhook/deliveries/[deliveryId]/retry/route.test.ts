import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const DELIVERY_ID = '660e8400-e29b-41d4-a716-446655440006'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, deliveryId: DELIVERY_ID }) }
}

describe('/api/v1/apps/[appId]/webhook/deliveries/[deliveryId]/retry POST', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when delivery missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_deliveries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, webhook_url: 'https://hook.example/h', webhook_secret: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when already delivered', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_deliveries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: DELIVERY_ID,
                      article_id: 'a1',
                      status: 'delivered',
                      attempt_count: 1,
                      payload: null,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, webhook_url: 'https://hook.example/h', webhook_secret: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_delivered')
  })

  it('returns 429 at max attempts', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_deliveries') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: DELIVERY_ID,
                      article_id: 'a1',
                      status: 'failed',
                      attempt_count: 10,
                      payload: { event: 'x' },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, webhook_url: 'https://hook.example/h', webhook_secret: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(429)
  })

  it('retries with stored payload and updates delivery', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    let deliveriesCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_deliveries') {
          deliveriesCalls += 1
          if (deliveriesCalls === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: DELIVERY_ID,
                        article_id: 'a1',
                        status: 'failed',
                        attempt_count: 2,
                        payload: { hello: 'world' },
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, webhook_url: 'https://hook.example/h', webhook_secret: null },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.retried).toBe(true)
    expect(body.status).toBe('delivered')
    expect(body.attempt_count).toBe(3)
    expect(fetchMock).toHaveBeenCalled()
  })
})
