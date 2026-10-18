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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function articlesCannibalChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/keywords/cannibalization', () => {
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

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        articlesCannibalChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns conflicts when two articles share focus_keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = [
      {
        id: '1',
        slug: 'a',
        title: 'A',
        focus_keyword: 'Widget Tips',
        status: 'published',
        gsc_avg_position: 8,
        published_at: '2026-01-01',
        updated_at: '2026-01-02',
      },
      {
        id: '2',
        slug: 'b',
        title: 'B',
        focus_keyword: 'widget tips',
        status: 'ranked',
        gsc_avg_position: 4,
        published_at: '2026-01-03',
        updated_at: '2026-01-04',
      },
    ]
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => articlesCannibalChain({ data: rows, error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      cannibalization_count: number
      conflicts: Array<{ keyword: string; article_count: number }>
    }
    expect(j.cannibalization_count).toBe(1)
    expect(j.conflicts[0].keyword).toBe('widget tips')
    expect(j.conflicts[0].article_count).toBe(2)
  })
})
