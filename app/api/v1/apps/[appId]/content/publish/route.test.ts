import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { expectJsonError } from '@/lib/testing/http-contracts'

const {
  mockParseIndexNow,
  mockResolveCanonical,
  mockResolveHost,
  mockSubmitIndexNow,
} = vi.hoisted(() => ({
  mockParseIndexNow: vi.fn(),
  mockResolveCanonical: vi.fn(),
  mockResolveHost: vi.fn(),
  mockSubmitIndexNow: vi.fn(),
}))

vi.mock('@/lib/indexnow', () => ({
  parseIndexNowFromMetadata: (m: unknown) => mockParseIndexNow(m),
  resolveCanonicalArticleUrl: (o: unknown) => mockResolveCanonical(o),
  resolveIndexNowHost: (u: string, h?: string | null) => mockResolveHost(u, h),
  submitUrlsToIndexNow: (p: unknown) => mockSubmitIndexNow(p),
}))

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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

const validBody = {
  article_id: ARTICLE_ID,
  slug: 'my-post',
}

function adminClientForPublishSuccess(appMetadata: Record<string, unknown> = {}) {
  const articleRow = {
    id: ARTICLE_ID,
    app_id: APP_ID,
    slug: 'my-post',
    meta_json: {},
  }
  const appRow = {
    id: APP_ID,
    base_url: 'https://example.com',
    metadata: appMetadata,
  }
  const updated = {
    id: ARTICLE_ID,
    slug: 'my-post',
    status: 'published',
    published_at: '2026-01-01T00:00:00Z',
  }

  let articlesFrom = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_articles') {
        articlesFrom += 1
        if (articlesFrom === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: articleRow,
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: updated, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_apps') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: appRow, error: null }),
            }),
          }),
        }
      }
      if (table === 'scp_publish_logs') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

describe('POST /api/v1/apps/[appId]/content/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseIndexNow.mockReturnValue({
      key: undefined,
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue(null)
    mockResolveHost.mockReturnValue(null)
    mockSubmitIndexNow.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      responseText: '{}',
    })
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('returns 404 when article is missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, base_url: null, metadata: {} },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 404, code: 'not_found' })
  })

  it('returns 404 app_not_found when app row is missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: ARTICLE_ID,
                      app_id: APP_ID,
                      slug: 'my-post',
                      meta_json: {},
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 404, code: 'app_not_found' })
  })

  it('returns 400 when slug does not match article', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: ARTICLE_ID,
                      app_id: APP_ID,
                      slug: 'real-slug',
                      meta_json: {},
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, base_url: null, metadata: {} },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_id: ARTICLE_ID, slug: 'wrong-slug' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'slug_mismatch' })
  })

  it('returns 500 when update fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          articlesFrom += 1
          if (articlesFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: ARTICLE_ID,
                        app_id: APP_ID,
                        slug: 'my-post',
                        meta_json: {},
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'row locked' },
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, base_url: null, metadata: {} },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 500, code: 'update_failed' })
  })

  it('returns 200 and marks published without IndexNow when not configured', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      article: { status: string }
      indexnow?: unknown
    }
    expect(body.article.status).toBe('published')
    expect(body.indexnow).toBeUndefined()
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('includes indexnow skipped no_canonical when submit_indexnow and no URL', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: '12345678',
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue(null)
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      indexnow: { attempted: boolean; skipped_reason?: string }
    }
    expect(body.indexnow.attempted).toBe(false)
    expect(body.indexnow.skipped_reason).toBe('no_canonical_url')
    expect(mockSubmitIndexNow).not.toHaveBeenCalled()
  })

  it('includes indexnow skipped when key missing but submit requested', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: undefined,
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/blog/my-post')
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = (await res.json()) as {
      indexnow: { skipped_reason?: string }
    }
    expect(body.indexnow.skipped_reason).toBe('indexnow_key_missing')
  })

  it('includes indexnow skipped host_required when host cannot be resolved', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: '12345678',
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/blog/my-post')
    mockResolveHost.mockReturnValue(null)
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = (await res.json()) as {
      indexnow: { skipped_reason?: string; url?: string }
    }
    expect(body.indexnow.skipped_reason).toBe('host_required')
    expect(body.indexnow.url).toBe('https://example.com/blog/my-post')
  })

  it('submits IndexNow when submit_indexnow and key resolve', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: '12345678',
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/blog/my-post')
    mockResolveHost.mockReturnValue('example.com')
    mockSubmitIndexNow.mockResolvedValue({
      ok: true,
      httpStatus: 202,
      responseText: '',
    })
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = (await res.json()) as {
      indexnow: { attempted: boolean; ok?: boolean; http_status?: number }
    }
    expect(body.indexnow.attempted).toBe(true)
    expect(body.indexnow.ok).toBe(true)
    expect(body.indexnow.http_status).toBe(202)
    expect(mockSubmitIndexNow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'example.com',
        key: '12345678',
        urlList: ['https://example.com/blog/my-post'],
      })
    )
  })

  it('records indexnow failure when submit throws', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: '12345678',
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/blog/my-post')
    mockResolveHost.mockReturnValue('example.com')
    mockSubmitIndexNow.mockRejectedValue(new Error('timeout'))
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = (await res.json()) as {
      indexnow: { attempted: boolean; ok: boolean; error?: string }
    }
    expect(body.indexnow.attempted).toBe(true)
    expect(body.indexnow.ok).toBe(false)
    expect(body.indexnow.error).toContain('timeout')
  })

  it('returns 200 with indexnow ok false when API rejects (non-throw)', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: '12345678',
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/blog/my-post')
    mockResolveHost.mockReturnValue('example.com')
    const longBody = 'x'.repeat(400)
    mockSubmitIndexNow.mockResolvedValue({
      ok: false,
      httpStatus: 502,
      responseText: longBody,
    })
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ ...validBody, submit_indexnow: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      indexnow: {
        attempted: boolean
        ok: boolean
        http_status?: number
        error?: string
        url?: string
      }
    }
    expect(body.indexnow.attempted).toBe(true)
    expect(body.indexnow.ok).toBe(false)
    expect(body.indexnow.http_status).toBe(502)
    expect(body.indexnow.url).toBe('https://example.com/blog/my-post')
    expect(body.indexnow.error).toHaveLength(300)
    expect(body.indexnow.error).toBe(longBody.slice(0, 300))
  })

  it('runs IndexNow on publish when metadata onPublish without submit_indexnow', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockParseIndexNow.mockReturnValue({
      key: 'abcdef12',
      keyLocation: 'https://example.com/key.txt',
      hostOverride: null,
      onPublish: true,
    })
    mockResolveCanonical.mockReturnValue('https://example.com/p/my-post')
    mockResolveHost.mockReturnValue('example.com')
    mockSubmitIndexNow.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      responseText: '{}',
    })
    mockCreateAdminClient.mockReturnValue(adminClientForPublishSuccess())

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify(validBody),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const out = (await res.json()) as {
      indexnow: { attempted: boolean; ok?: boolean }
    }
    expect(out.indexnow.attempted).toBe(true)
    expect(out.indexnow.ok).toBe(true)
    expect(mockSubmitIndexNow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'example.com',
        key: 'abcdef12',
        keyLocation: 'https://example.com/key.txt',
        urlList: ['https://example.com/p/my-post'],
      })
    )
  })
})
