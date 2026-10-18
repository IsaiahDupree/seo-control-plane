import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockRunBatch = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/process-pending-briefs', () => ({
  runProcessPendingBriefsBatch: (...args: unknown[]) => mockRunBatch(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function routeContext() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/briefs/process-pending', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockCreateAdminClient.mockReturnValue({})
  })

  it('returns 401 when requireAppAuth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'Invalid or missing API key for this app'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(401)
    expect(mockRunBatch).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when limit is out of range', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ limit: 10 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('accepts empty body and defaults limit to 1', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({ kind: 'empty' as const })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: unknown[]; message: string }
    expect(body.processed).toEqual([])
    expect(body.message).toBe('No pending briefs')
    expect(mockRunBatch).toHaveBeenCalledWith(APP_ID, 1, {})
  })

  it('passes generation overrides to the batch runner', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({ kind: 'empty' as const })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        limit: 2,
        target_word_count: 1200,
        content_type: 'guide',
        auto_deliver: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    await POST(req, routeContext())
    expect(mockRunBatch).toHaveBeenCalledWith(APP_ID, 2, {
      target_word_count: 1200,
      content_type: 'guide',
      auto_deliver: true,
    })
  })

  it('returns 404 for app_not_found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({ kind: 'app_not_found' as const })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(404)
  })

  it('returns 500 for query_failed', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({
      kind: 'query_failed' as const,
      message: 'timeout',
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(500)
  })

  it('returns 200 with processed and failures and writes audit', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({
      kind: 'success' as const,
      processed: [
        {
          brief_id: '770e8400-e29b-41d4-a716-446655440000',
          article_id: '880e8400-e29b-41d4-a716-446655440000',
          slug: 'x',
          title: 'X',
        },
      ],
      failures: [],
    })
    mockTryInsertUserAudit.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      processed: Array<{ slug: string }>
      audit_warning?: string
    }
    expect(body.processed).toHaveLength(1)
    expect(body.audit_warning).toBeUndefined()
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('includes audit_warning when audit insert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunBatch.mockResolvedValue({
      kind: 'success' as const,
      processed: [],
      failures: [],
    })
    mockTryInsertUserAudit.mockResolvedValue('audit table busy')

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    const body = (await res.json()) as { audit_warning?: string }
    expect(body.audit_warning).toBe('audit table busy')
  })
})
