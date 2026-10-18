import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCronBearerOk = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  cronBearerOk: (...args: unknown[]) => mockCronBearerOk(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

describe('GET /api/cron/gsc-pull', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 200 when there are no active apps', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; message?: string }
    expect(body.ok).toBe(true)
    expect(body.message).toBe('No active apps')
  })

  it('records no_gsc_config when app lacks GSC credentials', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: '550e8400-e29b-41d4-a716-446655440000',
                slug: 'no-gsc',
                context: {},
                base_url: null,
              },
            ],
            error: null,
          }),
        }),
      })),
    })

    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      results: Array<{ app: string; rows_upserted: number; error?: string }>
    }
    expect(body.results).toHaveLength(1)
    expect(body.results[0].app).toBe('no-gsc')
    expect(body.results[0].rows_upserted).toBe(0)
    expect(body.results[0].error).toBe('no_gsc_config')
  })

  it('upserts keywords when GSC returns rows', async () => {
    mockCronBearerOk.mockReturnValue(true)

    const upsertKeywords = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: '550e8400-e29b-41d4-a716-446655440000',
                    slug: 'with-gsc',
                    context: {
                      gsc_property_url: 'https://example.com/',
                      gsc_access_token: 'token',
                    },
                    base_url: 'https://example.com',
                  },
                ],
                error: null,
              }),
            }),
          }
        }
        if (table === 'scp_keywords') {
          return { upsert: upsertKeywords }
        }
        if (table === 'scp_gsc_performance') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        return {}
      }),
    })

    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          rows: [
            {
              keys: ['hello world', 'https://example.com/blog/hello'],
              clicks: 1,
              impressions: 10,
              ctr: 0.1,
              position: 5,
            },
          ],
        }),
        { status: 200 }
      )
    ) as typeof fetch

    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ app: string; rows_upserted: number; error?: string }>
    }
    expect(body.results[0].app).toBe('with-gsc')
    expect(body.results[0].rows_upserted).toBe(1)
    expect(body.results[0].error).toBeUndefined()
    expect(upsertKeywords).toHaveBeenCalled()
  })
})
