import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
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

describe('GET /api/v1/apps/[appId]/articles', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('returns 500 when query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderRangeChain({ data: null, error: { message: 'timeout' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    await expectJsonError(res, { status: 500, code: 'query_failed' })
  })

  it('returns 200 with default limit 25', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: '660e8400-e29b-41d4-a716-446655440000',
      slug: 'hello',
      title: 'Hello',
      description: null,
      status: 'draft',
      focus_keyword: null,
      content_type: null,
      cluster_name: null,
      word_count: null,
      qa_score: null,
      scheduled_publish_at: null,
      published_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    const body = await expectJson(
      res,
      z.object({
        items: z.array(z.object({ slug: z.string() })),
        limit: z.number(),
        has_more: z.boolean(),
      }),
      { status: 200 }
    )
    expect(body.items[0].slug).toBe('hello')
    expect(body.limit).toBe(25)
    expect(body.has_more).toBe(false)
  })

  it('parses comma-separated status and calls in()', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(
      new NextRequest('http://localhost/?status=draft%2Cpublished%2C%20'),
      ctx()
    )
    expect(chain.in).toHaveBeenCalledWith('status', ['draft', 'published'])
  })

  it('applies slug and focus_keyword filters after range', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    const url =
      'http://localhost/?slug=my-post&focus_keyword=seo%20tips'
    await GET(new NextRequest(url), ctx())
    expect(chain.eq).toHaveBeenCalledWith('slug', 'my-post')
    expect(chain.eq).toHaveBeenCalledWith('focus_keyword', 'seo tips')
  })

  it('caps limit at 100', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=500'), ctx())
    const body = await expectJson(
      res,
      z.object({
        items: z.array(z.unknown()),
        limit: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
      }),
      { status: 200 }
    )
    expect(body.limit).toBe(100)
  })
})
