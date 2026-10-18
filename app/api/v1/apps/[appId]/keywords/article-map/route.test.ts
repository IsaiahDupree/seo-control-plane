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

function articleMapClient(
  kwRows: unknown[],
  kwErr: unknown,
  artRows: unknown[],
  artErr: unknown
) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_keywords') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: kwRows, error: kwErr }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: artRows, error: artErr }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/article-map', () => {
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

  it('returns 500 when keywords query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      articleMapClient([], { message: 'kw fail' }, [], null)
    )
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('maps focus coverage and uncovered_only filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      articleMapClient(
        [
          {
            id: 'k1',
            keyword: 'covered kw',
            cluster_name: null,
            search_volume: 100,
            opportunity_score: 9,
            status: 'active',
            intent_type: 'informational',
          },
          {
            id: 'k2',
            keyword: 'orphan kw',
            cluster_name: null,
            search_volume: 50,
            opportunity_score: 8,
            status: 'active',
            intent_type: null,
          },
        ],
        null,
        [
          {
            id: 'a1',
            slug: 'p1',
            title: 'P1',
            focus_keyword: 'covered kw',
            status: 'published',
            cluster_name: null,
          },
        ],
        null
      )
    )
    const res = await GET(
      new NextRequest('http://localhost/?uncovered_only=true'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      mapping: Array<{ keyword: string; covered: boolean }>
      uncovered: number
    }
    expect(j.mapping).toHaveLength(1)
    expect(j.mapping[0].keyword).toBe('orphan kw')
    expect(j.mapping[0].covered).toBe(false)
    expect(j.uncovered).toBeGreaterThan(0)
  })
})
