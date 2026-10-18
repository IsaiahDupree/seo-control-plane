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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'
const TARGET_ID = '880e8400-e29b-41d4-a716-446655440008'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function edgeBuilder(result: { data: unknown[]; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/internal-links', () => {
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

  it('returns 500 when outgoing query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_internal_link_edges') {
          return edgeBuilder({ data: [], error: { message: 'fail' } })
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns empty outgoing and incoming', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_internal_link_edges') {
          return edgeBuilder({ data: [], error: null })
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      article_id: string
      outgoing: unknown[]
      incoming: unknown[]
    }
    expect(j.article_id).toBe(ARTICLE_ID)
    expect(j.outgoing).toEqual([])
    expect(j.incoming).toEqual([])
  })

  it('enriches outgoing links with article titles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const mockFrom = vi.fn()
    mockFrom
      .mockImplementationOnce(() =>
        edgeBuilder({
          data: [
            {
              id: 'e1',
              to_article_id: TARGET_ID,
              to_slug: 'fallback-slug',
              anchor_text: 'click',
              position_in_article: 1,
              is_pillar_link: false,
              semantic_score: 0.9,
              inserted_by: 'system',
              created_at: '2026-01-01',
            },
          ],
          error: null,
        })
      )
      .mockImplementationOnce(() =>
        edgeBuilder({ data: [], error: null })
      )
      .mockImplementationOnce(() => ({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: TARGET_ID,
                slug: 'real-slug',
                title: 'Target page',
              },
            ],
            error: null,
          }),
        }),
      }))
    mockCreateAdminClient.mockReturnValue({ from: mockFrom })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      outgoing: Array<{ to_slug: string; to_title: string | null }>
    }
    expect(j.outgoing).toHaveLength(1)
    expect(j.outgoing[0].to_slug).toBe('real-slug')
    expect(j.outgoing[0].to_title).toBe('Target page')
  })
})
