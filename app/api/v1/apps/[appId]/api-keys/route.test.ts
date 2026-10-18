import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
import {
  buildHeadCountChain,
  buildSelectEqOrderChain,
} from '@/lib/testing/supabase-mocks'

const { mockGenerateApiKey, mockHashKey } = vi.hoisted(() => ({
  mockGenerateApiKey: vi.fn(),
  mockHashKey: vi.fn(),
}))

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/api-key', () => ({
  generateApiKey: () => mockGenerateApiKey(),
  hashKey: (k: string) => mockHashKey(k),
}))

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const KEY_ROW = {
  id: '880e8400-e29b-41d4-a716-446655440000',
  key_prefix: 'scp_test_abcd',
  label: 'staging',
  revoked_at: null,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/api-keys', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      await expectJsonError(res, { status: 401, code: 'unauthorized' })
    })

    it('returns 500 when query errors', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqOrderChain({ data: null, error: { message: 'db' } })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      await expectJsonError(res, { status: 500, code: 'query_failed' })
    })

    it('returns 200 with keys array', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqOrderChain({ data: [KEY_ROW], error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      const body = await expectJson(
        res,
        z.object({
          keys: z.array(
            z.object({
              id: z.string(),
              key_prefix: z.string(),
              label: z.string(),
            })
          ),
        }),
        { status: 200 }
      )
      expect(body.keys).toHaveLength(1)
      expect(body.keys[0].key_prefix).toBe('scp_test_abcd')
    })
  })

  describe('POST', () => {
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
      await expectJsonError(res, { status: 401, code: 'unauthorized' })
    })

    it('returns 400 when label too long', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ label: 'a'.repeat(81) }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'validation_error' })
    })

    it('returns 400 key_limit when app already has 20 keys', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildHeadCountChain({ count: 20, error: null })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ label: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 400, code: 'key_limit' })
    })

    it('returns 500 when count query fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildHeadCountChain({ count: null, error: { message: 'timeout' } })
        ),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      await expectJsonError(res, { status: 500, code: 'query_failed' })
    })

    it('returns 200 with plaintext api_key once on success', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      const raw = 'scp_live_abcdefghijklmno'
      mockGenerateApiKey.mockReturnValue(raw)
      mockHashKey.mockResolvedValue('hashed-secret')

      let fromCalls = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          fromCalls += 1
          if (fromCalls === 1) {
            return buildHeadCountChain({ count: 3, error: null })
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { ...KEY_ROW, label: 'staging', key_prefix: raw.slice(0, 12) },
                  error: null,
                }),
              }),
            }),
          }
        }),
      })

      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ label: 'staging' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      const body = await expectJson(
        res,
        z.object({
          api_key: z.string(),
          key: z.object({ label: z.string(), key_prefix: z.string() }),
        }),
        { status: 200 }
      )
      expect(body.api_key).toBe(raw)
      expect(body.key.label).toBe('staging')
      expect(mockHashKey).toHaveBeenCalledWith(raw)
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
