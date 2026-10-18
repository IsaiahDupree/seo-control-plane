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

describe('GET /api/v1/apps/[appId]/context/approved-claims', () => {
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

  it('returns 404 when app missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns claim arrays from context', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                context: {
                  approved_claims: ['A'],
                  prohibited_claims: ['B'],
                  sensitive_topics: ['C'],
                },
              },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      approved_claims: string[]
      prohibited_claims: string[]
    }
    expect(j.approved_claims).toEqual(['A'])
    expect(j.prohibited_claims).toEqual(['B'])
  })
})

describe('POST /api/v1/apps/[appId]/context/approved-claims', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const long = 'x'.repeat(501)
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ approved_claims: [long] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 500 when update fails', async () => {
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
                  data: { context: {} },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'x' } }),
          }),
        }
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ sensitive_topics: ['tax'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('update_failed')
  })

  it('patches only provided claim fields', async () => {
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
                  data: { context: { approved_claims: ['old'] } },
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
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ prohibited_claims: ['do not say x'] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { prohibited_claims: string[] }
    expect(j.prohibited_claims).toEqual(['do not say x'])
    expect('approved_claims' in j).toBe(false)
  })
})
