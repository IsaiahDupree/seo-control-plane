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

describe('GET /api/v1/apps/[appId]/content/queue', () => {
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
        buildSelectEqOrderRangeChain({ data: null, error: { message: 'rls' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 200 and restricts status to approved and queued', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/'), ctx())
    expect(chain.in).toHaveBeenCalledWith('status', ['approved', 'queued'])
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
  })

  it('uses narrow columns by default', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/'), ctx())
    const sel = chain.select.mock.calls[0]?.[0] as string
    expect(sel).toContain('meta_json')
    expect(sel).not.toContain('body_mdx')
  })

  it('uses full column set when full=1', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/?full=1'), ctx())
    const sel = chain.select.mock.calls[0]?.[0] as string
    expect(sel).toContain('body_mdx')
    expect(sel).toContain('content_html')
  })

  it('treats full=true like full=1', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/?full=true'), ctx())
    const sel = chain.select.mock.calls[0]?.[0] as string
    expect(sel).toContain('body_mdx')
  })

  it('returns has_more when page is full', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      slug: `s-${i}`,
      title: 't',
      description: null,
      status: 'approved',
      scheduled_publish_at: null,
      meta_json: {},
      updated_at: '2026-01-01T00:00:00Z',
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
