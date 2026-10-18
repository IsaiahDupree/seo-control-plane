import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

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

function generateAdmin() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_apps') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { base_url: 'https://site.example', domain: 'site.example' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        slug: 'hello',
                        updated_at: '2026-04-01T00:00:00Z',
                        published_at: '2026-03-01T00:00:00Z',
                        focus_keyword: 'x',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected ${table}`)
    }),
  }
}

describe('/api/v1/apps/[appId]/sitemap/generate GET', () => {
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

  it('returns 400 for invalid format', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/?format=yaml'), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_format')
  })

  it('returns JSON url list', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(generateAdmin())
    const res = await GET(new NextRequest('http://localhost/?format=json'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url_count).toBe(1)
    expect(body.urls[0].loc).toBe('https://site.example/blog/hello')
    expect(body.base_url).toBe('https://site.example')
  })

  it('returns XML sitemap', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(generateAdmin())
    const res = await GET(new NextRequest('http://localhost/?format=xml'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/xml')
    const text = await res.text()
    expect(text).toContain('https://site.example/blog/hello')
    expect(text).toContain('<urlset')
  })
})
