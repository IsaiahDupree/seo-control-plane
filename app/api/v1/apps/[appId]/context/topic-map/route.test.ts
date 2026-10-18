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

describe('GET /api/v1/apps/[appId]/context/topic-map', () => {
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

  it('returns topic_map with cluster_keyword_counts', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    context: {
                      topic_map: {
                        pillars: [
                          {
                            name: 'P',
                            clusters: ['alpha'],
                          },
                        ],
                      },
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_keywords') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({
                  data: [
                    { cluster_name: 'alpha', status: 'active' },
                    { cluster_name: 'alpha', status: 'active' },
                    { cluster_name: 'beta', status: 'draft' },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      topic_map: { pillars: unknown[] }
      cluster_keyword_counts: Record<string, number>
    }
    expect(j.topic_map.pillars).toHaveLength(1)
    expect(j.cluster_keyword_counts.alpha).toBe(2)
    expect(j.cluster_keyword_counts.beta).toBeUndefined()
  })
})

describe('POST /api/v1/apps/[appId]/context/topic-map', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for invalid pillars shape', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ pillars: [{ name: 'x' }] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('saves topic_map', async () => {
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
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })
    const body = {
      pillars: [
        {
          name: 'Main',
          description: 'd',
          clusters: ['c1'],
          pillar_article_slug: 'main',
        },
      ],
    }
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { topic_map: typeof body }
    expect(j.topic_map.pillars[0].name).toBe('Main')
  })
})
