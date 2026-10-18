import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
import { z } from 'zod'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '550e8400-e29b-41d4-a716-446655440001'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function metricsGetChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

function articlesInChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

function metricsUpsertChain(result: { error: unknown }) {
  return {
    upsert: vi.fn().mockResolvedValue(result),
  }
}

describe('GET/POST /api/v1/apps/[appId]/analytics/page-experience', () => {
  afterEach(() => vi.clearAllMocks())

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('GET returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_page_experience') return metricsGetChain({ data: null, error: { message: 'db' } })
        return articlesInChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=10'), ctx())
    await expectJsonError(res, { status: 500, code: 'query_failed' })
  })

  it('GET returns enriched metrics and sorting flag', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_page_experience') {
          return metricsGetChain({
            data: [
              { article_id: ARTICLE_ID, lcp_ms: 4500, cls_score: 0.2, mobile_score: 60, captured_at: '2026-01-01T00:00:00Z' },
            ],
            error: null,
          })
        }
        return articlesInChain({
          data: [{ id: ARTICLE_ID, slug: 'one', title: 'One' }],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?sort_by=lcp&limit=30'), ctx())
    const j = await expectJson(
      res,
      z.object({
        sort_by: z.string(),
        total: z.number(),
        metrics: z.array(
          z.object({
            slug: z.string().nullable(),
            lcp_grade: z.string().nullable(),
            cls_grade: z.string().nullable(),
          })
        ),
      }),
      { status: 200 }
    )
    expect(j.sort_by).toBe('lcp')
    expect(j.total).toBe(1)
    expect(j.metrics[0].slug).toBe('one')
    expect(j.metrics[0].lcp_grade).toBe('poor')
    expect(j.metrics[0].cls_grade).toBe('needs_improvement')
  })

  it('POST returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const req = new NextRequest('http://localhost/', { method: 'POST', body: JSON.stringify({}) })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('POST returns 400 invalid_json when body is not JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', { method: 'POST', body: '{' })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'invalid_json' })
  })

  it('POST returns 400 validation_error for invalid body', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', { method: 'POST', body: JSON.stringify({ article_id: 'nope' }) })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'validation_error' })
  })

  it('POST returns 500 insert_failed when upsert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => metricsUpsertChain({ error: { message: 'db' } })),
    })
    const req = new NextRequest('http://localhost/', { method: 'POST', body: JSON.stringify({ article_id: ARTICLE_ID, lcp_ms: 1000 }) })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 500, code: 'insert_failed' })
  })

  it('POST stores metrics and returns captured_at', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => metricsUpsertChain({ error: null })),
    })
    const req = new NextRequest('http://localhost/', { method: 'POST', body: JSON.stringify({ article_id: ARTICLE_ID, lcp_ms: 1200, cls_score: 0.05 }) })
    const res = await POST(req, ctx())
    const j = await expectJson(
      res,
      z.object({
        article_id: z.string(),
        stored: z.boolean(),
        captured_at: z.string(),
      }),
      { status: 200 }
    )
    expect(j.article_id).toBe(ARTICLE_ID)
    expect(j.stored).toBe(true)
    expect(typeof j.captured_at).toBe('string')
  })
})

