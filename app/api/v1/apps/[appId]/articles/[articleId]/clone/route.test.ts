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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

const sourceArticle = {
  id: ARTICLE_ID,
  slug: 'original',
  title: 'Source title',
  focus_keyword: 'kw',
  description: null,
  body_mdx: 'x',
  table_of_contents: null,
  meta_title: null,
  meta_description: null,
  cluster_name: null,
  secondary_keywords: null,
  intent_type: null,
  target_word_count: null,
  cta_blocks: null,
  faq_schema: null,
  tags: null,
}

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/articles/[articleId]/clone', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when source article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when new slug already exists', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        articlesFrom += 1
        if (articlesFrom === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: sourceArticle,
            error: null,
          })
        }
        return buildSelectEqEqMaybeSingleChain({
          data: { id: 'other' },
          error: null,
        })
      }),
    })
    const res = await POST(jsonPost({ new_slug: 'taken-slug' }), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('slug_conflict')
  })

  it('returns 201 when clone succeeds', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        articlesFrom += 1
        if (articlesFrom === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: sourceArticle,
            error: null,
          })
        }
        if (articlesFrom === 2) {
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: '990e8400-e29b-41d4-a716-446655440099',
                  slug: 'custom-slug',
                  title: 'Custom title',
                },
                error: null,
              }),
            }),
          }),
        }
      }),
    })
    const res = await POST(
      jsonPost({
        new_slug: 'custom-slug',
        new_title: 'Custom title',
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const j = (await res.json()) as {
      new_article_id: string
      new_slug: string
      status: string
    }
    expect(j.new_slug).toBe('custom-slug')
    expect(j.status).toBe('draft')
    expect(j.new_article_id).toBe('990e8400-e29b-41d4-a716-446655440099')
  })
})
