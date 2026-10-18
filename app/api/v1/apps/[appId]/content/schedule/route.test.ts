import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  createClientForScheduleArticleUpdateFailure,
  createClientForSchedulePublishSuccess,
  createClientForScheduleQueueClearFailure,
  createClientForScheduleQueueInsertFailure,
  createClientWithArticleScheduleQuery,
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
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'
const QUEUE_ROW_ID = '880e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/content/schedule', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when first_publish_at is not parseable', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ first_publish_at: 'not-a-date' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_date')
  })

  it('returns 500 when candidate query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientWithArticleScheduleQuery({
        data: null,
        error: { message: 'timeout' },
      })
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 200 with empty scheduled when no approved articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientWithArticleScheduleQuery({ data: [], error: null })
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scheduled: unknown[]; message: string }
    expect(body.scheduled).toEqual([])
    expect(body.message).toContain('No approved')
  })

  it('returns 500 when clearing publish queue fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientForScheduleQueueClearFailure(ARTICLE_ID, 'fk violation')
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_ids: [ARTICLE_ID] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('queue_clear_failed')
  })

  it('returns 500 when article update fails mid-schedule', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientForScheduleArticleUpdateFailure(ARTICLE_ID, 'row locked')
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_ids: [ARTICLE_ID] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('article_update_failed')
  })

  it('schedules one article, updates row, inserts queue, and audits', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue(
      createClientForSchedulePublishSuccess(ARTICLE_ID, QUEUE_ROW_ID)
    )

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_ids: [ARTICLE_ID] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      scheduled: Array<{ article_id: string; queue_id: string; scheduled_publish_at: string }>
    }
    expect(body.scheduled).toHaveLength(1)
    expect(body.scheduled[0].article_id).toBe(ARTICLE_ID)
    expect(body.scheduled[0].queue_id).toBe(QUEUE_ROW_ID)
    expect(body.scheduled[0].scheduled_publish_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('returns 500 when publish_queue insert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientForScheduleQueueInsertFailure(ARTICLE_ID, 'duplicate key')
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_ids: [ARTICLE_ID] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('queue_insert_failed')
  })
})
