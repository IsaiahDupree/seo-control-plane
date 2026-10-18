import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function keywordsUpsertChain(result: { data: unknown; error: unknown }) {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(buildThenableFluentChain([], result)),
    }),
  }
}

function perfUpsertChain(result: { data: unknown; error: unknown }) {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(buildThenableFluentChain([], result)),
    }),
  }
}

describe('POST /api/v1/apps/[appId]/keywords/gsc-sync', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [{ keyword: 'a' }] }),
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', { method: 'POST', body: 'not-json' }),
      ctx()
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [] }),
      }),
      ctx()
    )
    expect(res.status).toBe(400)
  })

  it('returns 500 when keyword upsert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_keywords') {
          return keywordsUpsertChain({ data: null, error: { message: 'dup' } })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [{ keyword: 'hello world' }] }),
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('upsert_failed')
  })

  it('returns 200 syncing keywords only when clicks/impressions omitted', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const kwRow = {
      id: 'k1',
      keyword: 'hello world',
      cluster_name: null,
      search_volume: null,
      difficulty: null,
      status: 'active',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_keywords') {
          return keywordsUpsertChain({ data: [kwRow], error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ rows: [{ keyword: 'Hello World' }] }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      keywords_synced: number
      gsc_performance_synced: number
      items: unknown[]
    }
    expect(body.keywords_synced).toBe(1)
    expect(body.gsc_performance_synced).toBe(0)
    expect(body.items).toHaveLength(1)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('returns 500 when gsc_performance upsert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const kwRow = {
      id: 'k1',
      keyword: 'x',
      cluster_name: null,
      search_volume: null,
      difficulty: null,
      status: 'active',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_keywords') {
          return keywordsUpsertChain({ data: [kwRow], error: null })
        }
        if (t === 'scp_gsc_performance') {
          return perfUpsertChain({ data: null, error: { message: 'perf fail' } })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          rows: [{ keyword: 'x', clicks: 1, impressions: 5 }],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('gsc_perf_upsert_failed')
  })

  it('returns 200 with performance rows when clicks and impressions provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const kwRow = {
      id: 'k1',
      keyword: 'x',
      cluster_name: null,
      search_volume: null,
      difficulty: null,
      status: 'active',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_keywords') {
          return keywordsUpsertChain({ data: [kwRow], error: null })
        }
        if (t === 'scp_gsc_performance') {
          return perfUpsertChain({ data: [{ id: 'p1' }], error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          rows: [{ keyword: 'x', clicks: 2, impressions: 20, ctr: 0.1, position: 3 }],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      keywords_synced: number
      gsc_performance_synced: number
    }
    expect(body.keywords_synced).toBe(1)
    expect(body.gsc_performance_synced).toBe(1)
  })
})
