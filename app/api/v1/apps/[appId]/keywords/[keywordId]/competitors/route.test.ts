import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqEqMaybeSingleChain } from '@/lib/testing/supabase-mocks'

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
const KEYWORD_ID = '660e8400-e29b-41d4-a716-446655440003'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, keywordId: KEYWORD_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/[keywordId]/competitors', () => {
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

  it('returns 404 when keyword missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns serp rows ordered by position', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEYWORD_ID,
              keyword: 'kw',
              cluster_name: null,
              gsc_position: 5,
            },
            error: null,
          })
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        domain: 'd.com',
                        url: 'https://d.com/p',
                        title: 'T',
                        position: 1,
                        captured_at: '2026-01-01',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      our_position: number | null
      serp_results: Array<{ position: number }>
    }
    expect(j.our_position).toBe(5)
    expect(j.serp_results).toHaveLength(1)
    expect(j.serp_results[0].position).toBe(1)
  })
})

describe('POST /api/v1/apps/[appId]/keywords/[keywordId]/competitors', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serp_results: [] }),
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('upserts serp results', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({ upsert })),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serp_results: [
            {
              domain: 'ex.com',
              url: 'https://ex.com/u',
              position: 3,
            },
          ],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const j = (await res.json()) as { stored: number }
    expect(j.stored).toBe(1)
    expect(upsert).toHaveBeenCalled()
  })
})
