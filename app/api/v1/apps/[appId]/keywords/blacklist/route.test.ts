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

describe('/api/v1/apps/[appId]/keywords/blacklist', () => {
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

  it('GET returns excluded keywords', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: 'k1', keyword: 'spam', status: 'excluded', updated_at: '2026-01-01' }],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).count).toBe(1)
  })

  it('POST returns 400 when keywords empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ keywords: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
  })

  it('POST upserts blacklist rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'k2', keyword: 'bad', status: 'excluded' }],
            error: null,
          }),
        }),
      })),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ keywords: ['Bad'], reason: 'spam' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).blacklisted).toBe(1)
  })

  it('DELETE returns 400 without keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await DELETE(new NextRequest('http://localhost/', { method: 'DELETE' }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('missing_keyword')
  })

  it('DELETE reactivates keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      })),
    })
    const res = await DELETE(
      new NextRequest('http://localhost/?keyword=' + encodeURIComponent('bad'), { method: 'DELETE' }),
      ctx()
    )
    expect(res.status).toBe(200)
    expect((await res.json()).removed_from_blacklist).toBe('bad')
  })
})
