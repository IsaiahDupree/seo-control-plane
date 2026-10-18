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

describe('/api/v1/apps/[appId]/keywords/seeds', () => {
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

  it('GET returns seeds', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [{ id: '1', keyword: 'hello', is_seed: true }],
                error: null,
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.seeds[0].keyword).toBe('hello')
  })

  it('POST returns 400 when seeds empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ seeds: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
  })

  it('POST upserts seeds', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'k1', keyword: 'seed phrase', is_seed: true }],
            error: null,
          }),
        }),
      })),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ seeds: [{ keyword: 'Seed Phrase' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.saved).toBe(1)
    expect(body.seeds[0].keyword).toBe('seed phrase')
  })
})
