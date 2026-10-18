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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const A1 = '770e8400-e29b-41d4-a716-446655440007'
const A2 = '880e8400-e29b-41d4-a716-446655440008'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/content/refresh', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ article_ids: [A1] }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 404 when no articles match IDs', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(jsonPost({ article_ids: [A1] }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_found')
  })

  it('returns 500 when article lookup fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'db' },
            }),
          }),
        }),
      })),
    })
    const res = await POST(jsonPost({ article_ids: [A1] }), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 500 when queue upsert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: A1, status: 'published' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_refresh_queue') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: { message: 'conflict' } }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(jsonPost({ article_ids: [A1] }), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('queue_failed')
  })

  it('returns 202 with invalid_ids for unknown UUIDs', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: A1, status: 'published' }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_refresh_queue') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(jsonPost({ article_ids: [A1, A2] }), ctx())
    expect(res.status).toBe(202)
    const j = (await res.json()) as {
      queued: number
      invalid_ids: string[]
      queued_article_ids: string[]
    }
    expect(j.queued).toBe(1)
    expect(j.invalid_ids).toEqual([A2])
    expect(j.queued_article_ids).toEqual([A1])
  })
})
