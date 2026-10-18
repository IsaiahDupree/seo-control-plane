import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

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
const OLD_OWNER = '660e8400-e29b-41d4-a716-446655440001'
const NEW_OWNER = '770e8400-e29b-41d4-a716-446655440002'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/transfer POST', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      new NextRequest('http://localhost/', { method: 'POST', body: '{}' }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when new_owner_user_id not a UUID', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ new_owner_user_id: 'not-uuid' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
  })

  it('returns 409 when app inactive', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: APP_ID, name: 'A', owner_id: OLD_OWNER, status: 'inactive' },
              error: null,
            }),
          }),
        }),
      })),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ new_owner_user_id: NEW_OWNER }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('app_inactive')
  })

  it('transfers ownership and audits', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    let appsCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        appsCalls += 1
        if (appsCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: APP_ID, name: 'A', owner_id: OLD_OWNER, status: 'active' },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ new_owner_user_id: NEW_OWNER, reason: 'sale' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transferred).toBe(true)
    expect(body.new_owner_id).toBe(NEW_OWNER)
    expect(mockTryInsertUserAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'app.ownership_transferred' })
    )
  })
})
