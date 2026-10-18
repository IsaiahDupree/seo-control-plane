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
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }) }
}

function qaChain(rows: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: rows, error }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/qa', () => {
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

  it('returns 500 when qa query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: { id: ARTICLE_ID },
            error: null,
          })
        }
        return qaChain([], { message: 'fail' })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns latest report by default', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const report = {
      id: 'aa0e8400-e29b-41d4-a716-446655440000',
      article_id: ARTICLE_ID,
      app_id: APP_ID,
      overall_score: 8,
      quality_score: 8,
      seo_score: 7,
      readability_score: 8,
      checks_passed: 10,
      checks_failed: 0,
      blocking_issues: [],
      warnings: [],
      outcome: 'pass',
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-01-01T00:00:00Z',
    }
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: { id: ARTICLE_ID },
            error: null,
          })
        }
        return qaChain([report], null)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { report: { outcome: string } }
    expect(body.report.outcome).toBe('pass')
  })

  it('returns reports array when all=1', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const r1 = {
      id: 'aa0e8400-e29b-41d4-a716-446655440000',
      article_id: ARTICLE_ID,
      app_id: APP_ID,
      overall_score: 8,
      quality_score: 8,
      seo_score: 7,
      readability_score: 8,
      checks_passed: 10,
      checks_failed: 0,
      blocking_issues: [],
      warnings: [],
      outcome: 'pass',
      reviewed_by: null,
      reviewed_at: null,
      created_at: '2026-01-02T00:00:00Z',
    }
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: { id: ARTICLE_ID },
            error: null,
          })
        }
        return qaChain([r1], null)
      }),
    })
    const res = await GET(
      new NextRequest('http://localhost/?all=1'),
      ctx()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reports: unknown[] }
    expect(body.reports).toHaveLength(1)
  })
})
