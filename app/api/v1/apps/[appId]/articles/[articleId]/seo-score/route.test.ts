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
  return { params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }) }
}

describe('/api/v1/apps/[appId]/articles/[articleId]/seo-score GET', () => {
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
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns score breakdown for article', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const bodyMdx =
      '## Intro\n\n' +
      'seo test keyword here\n\n' +
      '## More\n\n' +
      'seo test keyword [x](/path/a) [y](/path/b)\n\n' +
      '## Third\n\n' +
      'more seo test keyword content'
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: ARTICLE_ID,
                  slug: 'post',
                  title: 'seo test keyword — great title length here',
                  description: 'x'.repeat(130),
                  body_mdx: bodyMdx,
                  focus_keyword: 'seo test keyword',
                  meta_json: { og_title: 'OG' },
                  status: 'draft',
                  updated_at: '2026-01-01T00:00:00Z',
                },
                error: null,
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(body.checks.length).toBeGreaterThan(5)
    expect(body.seo_score).toBeGreaterThan(0)
    expect(body.max_score).toBeGreaterThan(0)
    expect(['A', 'B', 'C', 'D', 'F']).toContain(body.grade)
  })
})
