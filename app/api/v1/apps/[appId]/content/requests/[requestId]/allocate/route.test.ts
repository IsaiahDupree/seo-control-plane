import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqSingleChain,
  buildUpdateEqEqThenChain,
} from '@/lib/testing/supabase-mocks'

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
const REQUEST_ID = 'aa0e8400-e29b-41d4-a716-446655440000'
const KW_ID = 'bb0e8400-e29b-41d4-a716-446655440000'
const BRIEF_ID = 'cc0e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, requestId: REQUEST_ID }) }
}

function keywordPickChain(rows: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: rows, error }),
            }),
          }),
        }),
      }),
    }),
  }
}

describe('POST /api/v1/apps/[appId]/content/requests/[requestId]/allocate', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when request not found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when request not open', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqSingleChain({
          data: {
            id: REQUEST_ID,
            app_id: APP_ID,
            requested_count: 2,
            status: 'processing',
          },
          error: null,
        })
      ),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_open')
  })

  it('returns 422 when not enough unassigned keywords', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_content_requests') {
          return buildSelectEqEqSingleChain({
            data: {
              id: REQUEST_ID,
              app_id: APP_ID,
              requested_count: 5,
              status: 'open',
            },
            error: null,
          })
        }
        if (table === 'scp_keywords') {
          return keywordPickChain([
            { id: KW_ID, keyword: 'one', cluster_name: null, intent: null },
          ])
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(422)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('insufficient_keywords')
  })

  it('returns 200 and allocates one keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    const kw = {
      id: KW_ID,
      keyword: 'seo tips',
      cluster_name: 'hub',
      intent: null,
    }
    const handlers: Array<{ table: string; impl: unknown }> = [
      {
        table: 'scp_content_requests',
        impl: buildSelectEqEqSingleChain({
          data: {
            id: REQUEST_ID,
            app_id: APP_ID,
            requested_count: 1,
            status: 'open',
          },
          error: null,
        }),
      },
      { table: 'scp_keywords', impl: keywordPickChain([kw]) },
      {
        table: 'scp_content_briefs',
        impl: {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: BRIEF_ID },
                error: null,
              }),
            }),
          }),
        },
      },
      {
        table: 'scp_keywords',
        impl: buildUpdateEqEqThenChain({ error: null }),
      },
      {
        table: 'scp_content_requests',
        impl: buildUpdateEqEqThenChain({ error: null }),
      },
    ]
    let i = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        const h = handlers[i]
        if (!h || h.table !== table) {
          throw new Error(`expected ${h?.table}, got ${table} at ${i}`)
        }
        i += 1
        return h.impl
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      brief_ids: string[]
      keywords_allocated: number
    }
    expect(body.status).toBe('processing')
    expect(body.brief_ids).toEqual([BRIEF_ID])
    expect(body.keywords_allocated).toBe(1)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
