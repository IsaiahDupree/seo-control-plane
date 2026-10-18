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

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/context/internal-links', () => {
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

  it('GET returns defaults when unset', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { context: {} }, error: null }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).internal_link_config.min_links_per_article).toBe(2)
  })

  it('POST returns 400 when min > max', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ min_links_per_article: 9, max_links_per_article: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_range')
  })

  it('POST updates config and logs', async () => {
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
                  maybeSingle: vi.fn().mockResolvedValue({ data: { context: {} }, error: null }),
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
      body: JSON.stringify({ max_links_per_article: 10 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).internal_link_config.max_links_per_article).toBe(10)
    expect(insertLog).toHaveBeenCalledWith(
      expect.objectContaining({ sync_type: 'internal_link_config' })
    )
  })
})
