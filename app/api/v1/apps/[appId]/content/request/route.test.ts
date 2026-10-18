import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { createClientWithInsertSingle } from '@/lib/testing/supabase-mocks'

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
const REQ_ID = '660e8400-e29b-41d4-a716-446655440000'

function routeContext() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/content/request', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when requireAppAuth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'Invalid or missing API key for this app'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ batch_size: 5 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when batch_size is invalid', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ batch_size: 0 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 500 when insert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientWithInsertSingle('scp_content_requests', null, { message: 'rls' })
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ batch_size: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('insert_failed')
  })

  it('returns 201-shaped payload on success', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientWithInsertSingle('scp_content_requests', {
        id: REQ_ID,
        requested_count: 7,
        status: 'open',
        created_at: '2026-01-01T00:00:00Z',
      }, null)
    )
    mockTryInsertUserAudit.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ batch_size: 7, notes: 'urgent' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      request_id: string
      batch_size: number
      status: string
      audit_warning?: string
    }
    expect(body.request_id).toBe(REQ_ID)
    expect(body.batch_size).toBe(7)
    expect(body.status).toBe('open')
    expect(body.audit_warning).toBeUndefined()
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('includes audit_warning when audit insert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      createClientWithInsertSingle('scp_content_requests', {
        id: REQ_ID,
        requested_count: 1,
        status: 'open',
        created_at: '2026-01-01T00:00:00Z',
      }, null)
    )
    mockTryInsertUserAudit.mockResolvedValue('skipped')

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ batch_size: 1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    const body = (await res.json()) as { audit_warning?: string }
    expect(body.audit_warning).toBe('skipped')
  })
})
