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

describe('GET /api/v1/apps/[appId]/audit-log', () => {
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
        buildSelectEqOrderRangeChain({ data: null, error: { message: 'timeout' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 200 with items and default limit 50', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: '880e8400-e29b-41d4-a716-446655440000',
      action: 'article.published',
      entity_type: 'article',
      entity_id: '660e8400-e29b-41d4-a716-446655440000',
      performed_by: null,
      performed_at: '2026-01-02T00:00:00Z',
      payload: {},
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items: Array<{ action: string }>
      limit: number
      offset: number
      has_more: boolean
    }
    expect(body.items).toHaveLength(1)
    expect(body.items[0].action).toBe('article.published')
    expect(body.limit).toBe(50)
    expect(body.offset).toBe(0)
    expect(body.has_more).toBe(false)
  })

  it('caps limit at 200', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=999'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { limit: number }
    expect(body.limit).toBe(200)
  })

  it('applies action and entity_type filters', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => chain),
    })
    const url =
      'http://localhost/?action=api_key.created&entity_type=api_key'
    await GET(new NextRequest(url), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).toHaveBeenCalledWith('action', 'api_key.created')
    expect(chain.eq).toHaveBeenCalledWith('entity_type', 'api_key')
  })

  it('sets has_more when page is full', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      action: 'x',
      performed_at: '2026-01-01T00:00:00Z',
    }))
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: items, error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=25'), ctx())
    const body = (await res.json()) as { has_more: boolean; items: unknown[] }
    expect(body.items).toHaveLength(25)
    expect(body.has_more).toBe(true)
  })
})
