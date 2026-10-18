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

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const TOKEN = 'scp_verify_existingtoken123456'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/domain/verify', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns 400 when no base_url or domain', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: APP_ID,
                base_url: null,
                domain: null,
                domain_verified: false,
                domain_verification_token: null,
              },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('no_domain')
  })

  it('GET returns instructions when token already set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: APP_ID,
                base_url: 'https://example.com',
                domain: 'example.com',
                domain_verified: false,
                domain_verification_token: TOKEN,
              },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.verification_token).toBe(TOKEN)
    expect(body.instructions.method_3_file).toContain('.well-known/scp-verification.txt')
  })

  it('POST verifies when well-known file matches token', async () => {
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
                  data: {
                    id: APP_ID,
                    base_url: 'https://example.com',
                    domain: 'example.com',
                    domain_verification_token: TOKEN,
                  },
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
    fetchMock.mockResolvedValue({ ok: true, text: async () => TOKEN })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).verified).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/.well-known/scp-verification.txt',
      expect.any(Object)
    )
  })

  it('POST returns 400 when no token', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: APP_ID,
                base_url: 'https://example.com',
                domain: null,
                domain_verification_token: null,
              },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('no_token')
  })
})
