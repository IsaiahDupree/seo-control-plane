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

import { DELETE, GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/context/url-exclusions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns stored exclusions', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { context: { url_exclusions: ['https://a.com/x'] } },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.url_exclusions[0]).toBe('https://a.com/x')
  })

  it('POST returns 400 when urls empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ urls: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
  })

  it('POST merges URLs and logs', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const insertLog = vi.fn().mockResolvedValue({ error: null })
    let appsCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          appsCalls += 1
          if (appsCalls === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { context: { url_exclusions: ['https://old.com'] } },
                    error: null,
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
        if (table === 'scp_app_sync_logs') {
          return { insert: insertLog }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://new.com'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(2)
    expect(body.url_exclusions).toEqual(expect.arrayContaining(['https://old.com', 'https://new.com']))
    expect(insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ sync_type: 'url_exclusions' })
    )
  })

  it('DELETE returns 400 when url missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await DELETE(new NextRequest('http://localhost/', { method: 'DELETE' }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('missing_url')
  })

  it('DELETE removes one URL', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let appsCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        appsCalls += 1
        if (appsCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { context: { url_exclusions: ['https://a.com', 'https://b.com'] } },
                  error: null,
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
      }),
    })
    const res = await DELETE(
      new NextRequest('http://localhost/?url=' + encodeURIComponent('https://a.com'), {
        method: 'DELETE',
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    expect((await res.json()).url_exclusions).toEqual(['https://b.com'])
  })
})
