import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function selectEqThenable(result: { data: unknown; error: unknown }) {
  return buildThenableFluentChain(['select', 'eq'], result)
}

describe('GET /api/v1/apps/[appId]/analytics/link-equity', () => {
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

  it('returns 500 when edges query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        selectEqThenable({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns empty top list when no edges', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        selectEqThenable({ data: [], error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_edges: number
      top_by_link_equity: unknown[]
    }
    expect(j.total_edges).toBe(0)
    expect(j.top_by_link_equity).toEqual([])
  })

  it('joins articles for inbound targets', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_internal_link_edges') {
          return selectEqThenable({
            data: [
              {
                to_article_id: ARTICLE_ID,
                from_article_id: 'other',
                is_pillar_link: true,
                semantic_score: 0.8,
              },
            ],
            error: null,
          })
        }
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: ARTICLE_ID,
                    slug: 'pillar',
                    title: 'Pillar',
                    cluster_name: 'hub',
                    gsc_avg_position: 2,
                  },
                ],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=5'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      top_by_link_equity: Array<{ slug: string | null; inbound_links: number }>
    }
    expect(j.top_by_link_equity.length).toBeGreaterThan(0)
    expect(j.top_by_link_equity[0].slug).toBe('pillar')
  })
})
