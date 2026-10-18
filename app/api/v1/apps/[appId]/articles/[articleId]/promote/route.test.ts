import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqThenChain,
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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/articles/[articleId]/promote', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ to_status: 'brief_ready' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid transition', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: ARTICLE_ID,
            slug: 's',
            title: 'T',
            status: 'draft',
          },
          error: null,
        })
      ),
    })
    const res = await POST(jsonPost({ to_status: 'published' }), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_transition')
  })

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({ to_status: 'brief_ready' }), ctx())
    expect(res.status).toBe(404)
  })

  it('promotes draft to brief_ready and audits', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        articlesFrom += 1
        if (articlesFrom === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: ARTICLE_ID,
              slug: 's',
              title: 'T',
              status: 'draft',
            },
            error: null,
          })
        }
        return buildUpdateEqThenChain({ error: null })
      }),
    })
    const res = await POST(
      jsonPost({ to_status: 'brief_ready', note: 'ok' }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      from_status: string
      to_status: string
    }
    expect(j.from_status).toBe('draft')
    expect(j.to_status).toBe('brief_ready')
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
