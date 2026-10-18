import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'

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
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/events/ingest', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ events: [{ event_name: 'click' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'invalid_json' })
  })

  it('returns 400 when events reference an article not in this app', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [],
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
      body: JSON.stringify({
        events: [{ event_name: 'x', article_id: ARTICLE_ID }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'article_mismatch' })
  })

  it('returns 500 when ownership query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'timeout' },
            }),
          }),
        }),
      })),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        events: [{ event_name: 'x', article_id: ARTICLE_ID }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 500, code: 'query_failed' })
  })

  it('returns 200 and inserts when article ids are valid', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: ARTICLE_ID }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_analytics_events') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: 'evt-1' }, { id: 'evt-2' }],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        events: [
          { event_name: 'a', article_id: ARTICLE_ID },
          { event_name: 'b', article_id: ARTICLE_ID },
        ],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = await expectJson(
      res,
      z.object({ inserted: z.number() }),
      { status: 200 }
    )
    expect(body.inserted).toBe(2)
  })

  it('returns 500 insert_failed when analytics insert errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: ARTICLE_ID }],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_analytics_events') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'rls' },
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        events: [{ event_name: 'x', article_id: ARTICLE_ID }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 500, code: 'insert_failed' })
  })

  it('skips article check when no article_id on events', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_analytics_events') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: 'e1' }],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        events: [{ event_name: 'page_view' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = await expectJson(
      res,
      z.object({ inserted: z.number() }),
      { status: 200 }
    )
    expect(body.inserted).toBe(1)
  })
})
