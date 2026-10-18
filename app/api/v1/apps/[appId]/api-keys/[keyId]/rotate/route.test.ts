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
const KEY_ID = '660e8400-e29b-41d4-a716-446655440003'
const NEW_KEY_ID = '770e8400-e29b-41d4-a716-446655440004'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, keyId: KEY_ID }) }
}

describe('/api/v1/apps/[appId]/api-keys/[keyId]/rotate POST', () => {
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

  it('returns 404 when key missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      })),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when key already revoked', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: KEY_ID, key_prefix: 'scp_testxxxx', label: 'L', revoked_at: '2026-01-01' },
                error: null,
              }),
            }),
          }),
        }),
      })),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('already_revoked')
  })

  it('rotates key and returns raw api_key once', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    let keyCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        keyCalls += 1
        if (keyCalls === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: KEY_ID, key_prefix: 'scp_oldprefix', label: 'Primary', revoked_at: null },
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        if (keyCalls === 2) {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: NEW_KEY_ID,
                    key_prefix: 'scp_newprefix',
                    label: 'Primary',
                    created_at: '2026-04-05T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rotated).toBe(true)
    expect(typeof body.api_key).toBe('string')
    expect(body.api_key.length).toBeGreaterThan(20)
    expect(body.new_key.id).toBe(NEW_KEY_ID)
    expect(mockTryInsertUserAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'api_key.rotated' })
    )
  })
})
