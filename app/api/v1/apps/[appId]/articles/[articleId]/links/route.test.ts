import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqSingleChain,
  buildSelectEqOrderChain,
  buildUpdateEqThenChain,
} from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockSuggestInternalLinks = vi.fn()
const mockApplyInternalLinks = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/internal-links', () => ({
  suggestInternalLinks: (...args: unknown[]) => mockSuggestInternalLinks(...args),
  applyInternalLinks: (...args: unknown[]) => mockApplyInternalLinks(...args),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'
const TO_ID = '770e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }) }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/links', () => {
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

  it('returns 500 when query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 200 with links array', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const row = {
      to_article_id: TO_ID,
      to_slug: 'other',
      anchor_text: 'read more',
      semantic_score: 0.9,
      created_at: '2026-01-01T00:00:00Z',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderChain({ data: [row], error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { links: Array<{ to_slug: string }> }
    expect(body.links).toHaveLength(1)
    expect(body.links[0].to_slug).toBe('other')
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/links', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const articleRow = {
    id: ARTICLE_ID,
    slug: 'post',
    content_html: '<p>Hello world</p>',
    body_mdx: null,
    focus_keyword: 'hello',
  }

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 200 with suggested links when inject is false', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqSingleChain({ data: articleRow, error: null })
      ),
    })
    mockSuggestInternalLinks.mockResolvedValue([
      { to_article_id: TO_ID, to_slug: 'other', anchor_text: 'more', semantic_score: 0.8 },
    ])
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ inject: false }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { suggested: number; links: unknown[] }
    expect(body.suggested).toBe(1)
    expect(body.links).toHaveLength(1)
    expect(mockSuggestInternalLinks).toHaveBeenCalledWith(
      APP_ID,
      ARTICLE_ID,
      expect.stringContaining('Hello')
    )
    expect(mockApplyInternalLinks).not.toHaveBeenCalled()
  })

  it('returns 200 with applied links when inject true and HTML unchanged', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqSingleChain({ data: articleRow, error: null })
      ),
    })
    mockApplyInternalLinks.mockResolvedValue({
      html: articleRow.content_html,
      links: [{ to_slug: 'x' }],
    })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ inject: true }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: number; audit_warning?: string }
    expect(body.applied).toBe(1)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('updates article when inject changes HTML', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t !== 'scp_articles') throw new Error(`unexpected ${t}`)
        articlesFrom += 1
        if (articlesFrom === 1) {
          return buildSelectEqEqSingleChain({ data: articleRow, error: null })
        }
        return buildUpdateEqThenChain({ error: null })
      }),
    })
    mockApplyInternalLinks.mockResolvedValue({
      html: '<p>Hello world <a href="/other">link</a></p>',
      links: [{ to_slug: 'other' }],
    })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ inject: true }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    expect(articlesFrom).toBe(2)
  })

  it('returns 500 when content update fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t !== 'scp_articles') throw new Error(`unexpected ${t}`)
        articlesFrom += 1
        if (articlesFrom === 1) {
          return buildSelectEqEqSingleChain({ data: articleRow, error: null })
        }
        return buildUpdateEqThenChain({ error: { message: 'write fail' } })
      }),
    })
    mockApplyInternalLinks.mockResolvedValue({
      html: '<p>changed</p>',
      links: [],
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ inject: true }),
      }),
      ctx()
    )
    expect(res.status).toBe(500)
  })
})
