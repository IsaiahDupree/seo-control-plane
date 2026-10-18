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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/analytics/backlink-summary', () => {
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

  it('returns 500 when backlinks query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'db' } }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('aggregates domains and joins top articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_backlinks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [
                    {
                      article_id: ARTICLE_ID,
                      source_domain: 'ref.com',
                      domain_rating: 45,
                      is_dofollow: true,
                      first_seen_at: null,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: ARTICLE_ID, slug: 'post', title: 'Post' }],
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
      total_backlinks: number
      top_linking_domains: Array<{ domain: string }>
      top_linked_articles: Array<{ slug: string | null }>
    }
    expect(j.total_backlinks).toBe(1)
    expect(j.top_linking_domains[0].domain).toBe('ref.com')
    expect(j.top_linked_articles[0].slug).toBe('post')
  })
})
