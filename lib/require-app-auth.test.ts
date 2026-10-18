import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mockVerify = vi.fn()

vi.mock('@/lib/api-key', () => ({
  verifyApiKeyForApp: (...args: unknown[]) => mockVerify(...args),
}))

import { requireAppAuth } from '@/lib/require-app-auth'

describe('requireAppAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns jsonError 401 when verify fails', async () => {
    mockVerify.mockResolvedValue(null)
    const req = new NextRequest('http://localhost/', {
      headers: { Authorization: 'Bearer bad' },
    })
    const out = await requireAppAuth(req, '550e8400-e29b-41d4-a716-446655440000')
    expect('error' in out).toBe(true)
    if ('error' in out) {
      expect(out.error.status).toBe(401)
      const body = await out.error.json()
      expect(body.error.code).toBe('unauthorized')
    }
    expect(mockVerify).toHaveBeenCalledWith(
      req,
      '550e8400-e29b-41d4-a716-446655440000'
    )
  })

  it('returns auth when verify succeeds', async () => {
    const appId = '550e8400-e29b-41d4-a716-446655440000'
    mockVerify.mockResolvedValue({ appId })
    const req = new NextRequest('http://localhost/')
    const out = await requireAppAuth(req, appId)
    expect('auth' in out).toBe(true)
    if ('auth' in out) expect(out.auth.appId).toBe(appId)
  })
})
