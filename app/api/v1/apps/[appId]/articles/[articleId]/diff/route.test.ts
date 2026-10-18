import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildArticleScheduleSelectChain } from '@/lib/testing/supabase-mocks'

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

describe('GET /api/v1/apps/[appId]/articles/[articleId]/diff', () => {
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

  it('returns 400 for invalid query params', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    const res = await GET(
      new NextRequest('http://localhost/?from_version=0'),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_query')
  })

  it('returns 500 when version query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildArticleScheduleSelectChain({
          data: null,
          error: { message: 'db' },
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 404 when no versions exist', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildArticleScheduleSelectChain({ data: [], error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('no_versions')
  })

  it('returns diff between latest and previous', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const versions = [
      {
        id: 'v2',
        version: 2,
        body_mdx: 'line-a\nline-b',
        title: 'T2',
        meta_json: {},
        created_at: '2026-02-01',
        created_by: null,
      },
      {
        id: 'v1',
        version: 1,
        body_mdx: 'line-a',
        title: 'T1',
        meta_json: {},
        created_at: '2026-01-01',
        created_by: null,
      },
    ]
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildArticleScheduleSelectChain({ data: versions, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      summary: { lines_added: number; lines_removed: number }
      to: { version: number }
      all_versions: unknown[]
    }
    expect(j.to.version).toBe(2)
    expect(j.summary.lines_added).toBeGreaterThan(0)
    expect(j.all_versions).toHaveLength(2)
  })
})
