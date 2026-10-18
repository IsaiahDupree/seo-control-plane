import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqEqThenChain,
} from '@/lib/testing/supabase-mocks'

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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/schedule', () => {
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

  it('returns scheduled fields', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: ARTICLE_ID,
            slug: 's',
            status: 'scheduled',
            scheduled_publish_at: '2026-06-01T12:00:00.000Z',
          },
          error: null,
        })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      scheduled_publish_at: string | null
      status: string
    }
    expect(j.status).toBe('scheduled')
    expect(j.scheduled_publish_at).toBe('2026-06-01T12:00:00.000Z')
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/schedule', () => {
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
        body: '{}',
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: 'not-json',
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when scheduled time is not in the future', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    const past = new Date(Date.now() - 60_000).toISOString()
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_publish_at: past, cancel: false }),
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_date')
  })

  it('cancels schedule with update only', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const articlesUpdate = buildUpdateEqEqThenChain({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') return articlesUpdate
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduled_publish_at: new Date(Date.now() + 86400000).toISOString(),
          cancel: true,
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { cancelled: boolean; scheduled_publish_at: null }
    expect(j.cancelled).toBe(true)
    expect(j.scheduled_publish_at).toBeNull()
  })

  it('schedules article and upserts publish queue', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const future = new Date(Date.now() + 7 * 86400000).toISOString()
    const articlesUpdate = buildUpdateEqEqThenChain({ error: null })
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') return articlesUpdate
        if (table === 'scp_publish_queue') return { upsert }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_publish_at: future, cancel: false }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { status: string; scheduled_publish_at: string }
    expect(j.status).toBe('scheduled')
    expect(j.scheduled_publish_at).toBe(future)
    expect(upsert).toHaveBeenCalled()
  })
})
