import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildHeadCountChain,
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqEqIsChain,
} from '@/lib/testing/supabase-mocks'

const mockHashKey = vi.fn()

vi.mock('@/lib/api-key', () => ({
  hashKey: (k: string) => mockHashKey(k),
}))

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

import { DELETE } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const KEY_ID = '880e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, keyId: KEY_ID }) }
}

function reqWithBearer(token: string) {
  return new NextRequest('http://localhost/', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

describe('DELETE /api/v1/apps/[appId]/api-keys/[keyId]', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await DELETE(reqWithBearer('tok'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 401 when Authorization bearer missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await DELETE(new NextRequest('http://localhost/', { method: 'DELETE' }), ctx())
    expect(res.status).toBe(401)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('unauthorized')
  })

  it('returns 500 when target key query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('h1')
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: null,
          error: { message: 'db' },
        })
      ),
    })
    const res = await DELETE(reqWithBearer('x'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 404 when key not found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('h1')
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await DELETE(reqWithBearer('x'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when key already revoked', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('h1')
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: KEY_ID,
            key_hash: 'other',
            revoked_at: '2026-01-01T00:00:00Z',
            key_prefix: 'pre_',
          },
          error: null,
        })
      ),
    })
    const res = await DELETE(reqWithBearer('x'), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('already_revoked')
  })

  it('returns 400 cannot_revoke_self when bearer matches target hash', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('same-hash')
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: KEY_ID,
            key_hash: 'same-hash',
            revoked_at: null,
            key_prefix: 'pre_',
          },
          error: null,
        })
      ),
    })
    const res = await DELETE(reqWithBearer('self-key'), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('cannot_revoke_self')
  })

  it('returns 400 last_key when only one active key', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('caller')
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEY_ID,
              key_hash: 'target-hash',
              revoked_at: null,
              key_prefix: 'pre_',
            },
            error: null,
          })
        }
        return buildHeadCountChain({ count: 1, error: null })
      }),
    })
    const res = await DELETE(reqWithBearer('other'), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('last_key')
  })

  it('returns 500 when active count query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('caller')
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEY_ID,
              key_hash: 'target-hash',
              revoked_at: null,
              key_prefix: 'pre_',
            },
            error: null,
          })
        }
        return buildHeadCountChain({ count: null, error: { message: 'timeout' } })
      }),
    })
    const res = await DELETE(reqWithBearer('other'), ctx())
    expect(res.status).toBe(500)
  })

  it('returns 500 when update fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockHashKey.mockResolvedValue('caller')
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEY_ID,
              key_hash: 'target-hash',
              revoked_at: null,
              key_prefix: 'pre_',
            },
            error: null,
          })
        }
        if (n === 2) return buildHeadCountChain({ count: 2, error: null })
        return buildUpdateEqEqIsChain({ error: { message: 'locked' } })
      }),
    })
    const res = await DELETE(reqWithBearer('other'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('update_failed')
  })

  it('returns 200 and revokes key', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockHashKey.mockResolvedValue('caller')
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: KEY_ID,
              key_hash: 'target-hash',
              revoked_at: null,
              key_prefix: 'pre_',
            },
            error: null,
          })
        }
        if (n === 2) return buildHeadCountChain({ count: 2, error: null })
        return buildUpdateEqEqIsChain({ error: null })
      }),
    })
    const res = await DELETE(reqWithBearer('other'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; revoked_at: string }
    expect(body.ok).toBe(true)
    expect(body.revoked_at).toMatch(/^\d{4}-/)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
