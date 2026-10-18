import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildArticleScheduleSelectChain,
  buildSelectEqEqMaybeSingleChain,
} from '@/lib/testing/supabase-mocks'

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
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/indexing', () => {
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

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }
        if (table === 'scp_apps') {
          return buildSelectEqEqMaybeSingleChain({
            data: { base_url: 'https://app.example', domain: 'app.example' },
            error: null,
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns indexing payload with GSC rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const canonical = 'https://app.example/blog/post-slug'
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 'post-slug',
              title: 'T',
              status: 'draft',
              published_at: '2026-01-01T00:00:00.000Z',
              canonical_url: null,
            },
            error: null,
          })
        }
        if (table === 'scp_apps') {
          return buildSelectEqEqMaybeSingleChain({
            data: { base_url: 'https://app.example', domain: 'app.example' },
            error: null,
          })
        }
        if (table === 'scp_gsc_performance') {
          return buildArticleScheduleSelectChain({
            data: [
              {
                page_url: canonical,
                avg_position: 12,
                impressions: 50,
                clicks: 2,
                date: '2026-01-10',
              },
            ],
            error: null,
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      canonical_url: string
      indexing: { gsc_has_data: boolean; total_impressions: number }
    }
    expect(j.canonical_url).toBe(canonical)
    expect(j.indexing.gsc_has_data).toBe(true)
    expect(j.indexing.total_impressions).toBe(50)
  })

  it('handles missing app row for base URL', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 'only-slug',
              title: 'T',
              status: 'published',
              published_at: '2020-01-01T00:00:00.000Z',
              canonical_url: null,
            },
            error: null,
          })
        }
        if (table === 'scp_apps') {
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }
        if (table === 'scp_gsc_performance') {
          return buildArticleScheduleSelectChain({ data: [], error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { canonical_url: string | null }
    expect(j.canonical_url).toBeNull()
  })
})
