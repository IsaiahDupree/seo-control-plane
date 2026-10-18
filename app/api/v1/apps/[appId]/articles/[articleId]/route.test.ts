import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqEqSelectSingleChain,
} from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { GET, PATCH } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }) }
}

const articleRow = {
  id: ARTICLE_ID,
  app_id: APP_ID,
  slug: 'post',
  title: 'Post',
  description: null,
  status: 'draft',
  body_mdx: '',
  content_html: null,
  content_markdown: null,
  meta_title: null,
  meta_description: null,
  meta_json: {},
  og_image_url: null,
  canonical_url: null,
  focus_keyword: null,
  secondary_keywords: null,
  content_type: null,
  cluster_name: null,
  word_count: null,
  reading_time_minutes: null,
  author: null,
  schema_json: null,
  table_of_contents: null,
  cta_blocks: null,
  internal_links: null,
  tags: null,
  qa_score: null,
  scheduled_publish_at: null,
  published_at: null,
  delivery_version: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

describe('/api/v1/apps/[appId]/articles/[articleId]', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
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
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 with article', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: articleRow, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { article: { slug: string } }
      expect(body.article.slug).toBe('post')
    })
  })

  describe('PATCH', () => {
    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: 'x',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 when body has no allowed fields', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 404 when article missing', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 and patches article', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      let articlesFrom = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          articlesFrom += 1
          if (articlesFrom === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: { id: ARTICLE_ID, status: 'draft' },
              error: null,
            })
          }
          return buildUpdateEqEqSelectSingleChain({
            data: { ...articleRow, title: 'New' },
            error: null,
          })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { article: { title: string } }
      expect(body.article.title).toBe('New')
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
