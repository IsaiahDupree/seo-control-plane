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

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

const articleRow = {
  id: ARTICLE_ID,
  slug: 'my-post',
  title: 'Hello',
  description: 'Desc',
  body_mdx: '## Hi\n\nBody',
  focus_keyword: 'k',
  tags: ['t'],
  status: 'published',
  published_at: '2026-01-01',
  meta_json: {},
  updated_at: '2026-01-02',
}

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function clientWithArticle() {
  return {
    from: vi.fn(() =>
      buildSelectEqEqMaybeSingleChain({ data: articleRow, error: null })
    ),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/export', () => {
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
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid format', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(clientWithArticle())
    const res = await GET(
      new NextRequest('http://localhost/?format=pdf'),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_format')
  })

  it('returns JSON document when format=json', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(clientWithArticle())
    const res = await GET(
      new NextRequest('http://localhost/?format=json'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { slug: string; body_mdx: string }
    expect(j.slug).toBe('my-post')
    expect(j.body_mdx).toContain('## Hi')
  })

  it('returns markdown attachment by default', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(clientWithArticle())
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    expect(res.headers.get('Content-Disposition')).toContain('my-post.md')
    const text = await res.text()
    expect(text).toContain('---')
    expect(text).toContain('## Hi')
  })

  it('returns HTML attachment when format=html', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(clientWithArticle())
    const res = await GET(
      new NextRequest('http://localhost/?format=html'),
      ctx()
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(res.headers.get('Content-Disposition')).toContain('my-post.html')
    const text = await res.text()
    expect(text).toContain('<!DOCTYPE html>')
    expect(text).toContain('Hello')
  })
})
