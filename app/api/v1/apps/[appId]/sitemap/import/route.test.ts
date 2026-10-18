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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function req(url: string) {
  return new NextRequest(`http://localhost/api?sitemap=1&url=${encodeURIComponent(url)}`, {
    method: 'POST',
  })
}

describe('/api/v1/apps/[appId]/sitemap/import POST', () => {
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
    const res = await POST(req('https://example.com/sitemap.xml'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 when url query missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('missing_url')
  })

  it('returns 400 when url invalid', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(req('not-a-url'), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_url')
  })

  it('returns 502 when fetch fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    fetchMock.mockRejectedValue(new Error('network down'))
    const res = await POST(req('https://example.com/sitemap.xml'), ctx())
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('fetch_failed')
  })

  it('returns 422 when sitemap has no URLs', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    fetchMock.mockResolvedValue({ ok: true, text: async () => '<urlset></urlset>' })
    const res = await POST(req('https://example.com/sitemap.xml'), ctx())
    expect(res.status).toBe(422)
    expect((await res.json()).error.code).toBe('no_urls')
  })

  it('imports blog URLs and upserts publications', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const xml =
      '<urlset><url><loc>https://example.com/blog/post-one</loc></url></urlset>'
    fetchMock.mockResolvedValue({ ok: true, text: async () => xml })
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ upsert })),
    })
    const res = await POST(req('https://example.com/sitemap.xml'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imported).toBe(1)
    expect(body.blog_urls_found).toBe(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          app_id: APP_ID,
          url: 'https://example.com/blog/post-one',
          status: 'published',
          source: 'sitemap_import',
        }),
      ]),
      { onConflict: 'app_id,url', ignoreDuplicates: true }
    )
  })
})
