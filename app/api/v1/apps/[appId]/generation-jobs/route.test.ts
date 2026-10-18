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
const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/generation-jobs', () => {
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

  it('returns 200 with default limit 50', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      id: '880e8400-e29b-41d4-a716-446655440000',
      brief_id: BRIEF_ID,
      article_id: ARTICLE_ID,
      status: 'complete',
      llm_provider: 'openai',
      llm_model: 'gpt-4',
      total_tokens: 1000,
      cost_usd: 0.01,
      error_message: null,
      started_at: null,
      completed_at: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [row], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; limit: number }
    expect(body.items).toHaveLength(1)
    expect(body.limit).toBe(50)
  })

  it('applies status, brief_id, article_id after range', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    const url = new URL('http://localhost/')
    url.searchParams.set('status', 'running')
    url.searchParams.set('brief_id', BRIEF_ID)
    url.searchParams.set('article_id', ARTICLE_ID)
    await GET(new NextRequest(url), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).toHaveBeenCalledWith('status', 'running')
    expect(chain.eq).toHaveBeenCalledWith('brief_id', BRIEF_ID)
    expect(chain.eq).toHaveBeenCalledWith('article_id', ARTICLE_ID)
  })

  it('caps limit at 200', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=999'), ctx())
    expect((await res.json()).limit).toBe(200)
  })
})
