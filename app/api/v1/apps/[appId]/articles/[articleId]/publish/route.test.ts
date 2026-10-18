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

const articleRow = {
  id: ARTICLE_ID,
  slug: 'post',
  title: 'T',
  status: 'draft',
  app_id: APP_ID,
}

describe('POST /api/v1/apps/[appId]/articles/[articleId]/publish', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      jsonPost({ action: 'publish' }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when schedule action missing scheduled_publish_at', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: articleRow, error: null })
      ),
    })
    const res = await POST(jsonPost({ action: 'schedule' }), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('missing_field')
  })

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({ action: 'publish' }), ctx())
    expect(res.status).toBe(404)
  })

  it('publishes article, logs event, and records audit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    let articlesFrom = 0
    const insertLog = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          articlesFrom += 1
          if (articlesFrom === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: articleRow,
              error: null,
            })
          }
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_publish_logs') {
          return { insert: insertLog }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(
      jsonPost({
        action: 'publish',
        canonical_url: 'https://example.com/p',
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { action: string; status: string }
    expect(j.action).toBe('publish')
    expect(j.status).toBe('published')
    expect(insertLog).toHaveBeenCalled()
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('schedules without publish log insert', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    let articlesFrom = 0
    const insertLog = vi.fn()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          articlesFrom += 1
          if (articlesFrom === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: articleRow,
              error: null,
            })
          }
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_publish_logs') {
          return { insert: insertLog }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const when = new Date(Date.now() + 86400000).toISOString()
    const res = await POST(
      jsonPost({ action: 'schedule', scheduled_publish_at: when }),
      ctx()
    )
    expect(res.status).toBe(200)
    expect(insertLog).not.toHaveBeenCalled()
  })
})
