import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockHostFromUrl = vi.fn()
const mockParseIndexNowFromMetadata = vi.fn()
const mockSubmitUrlsToIndexNow = vi.fn()

vi.mock('@/lib/indexnow', () => ({
  hostFromUrl: (u: string) => mockHostFromUrl(u),
  parseIndexNowFromMetadata: (m: unknown) => mockParseIndexNowFromMetadata(m),
  submitUrlsToIndexNow: (p: unknown) => mockSubmitUrlsToIndexNow(p),
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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function appSelectSingle(data: unknown, error: unknown) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data, error }),
        }),
      }),
    })),
  }
}

describe('POST /api/v1/apps/[appId]/indexnow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseIndexNowFromMetadata.mockReturnValue({
      key: undefined,
      keyLocation: undefined,
      hostOverride: undefined,
      onPublish: false,
    })
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/a'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 when IndexNow key is missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle({ id: APP_ID, metadata: {} }, null)
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://example.com/page'] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('indexnow_key_required')
  })

  it('returns 400 when host cannot be derived', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle({ id: APP_ID, metadata: {} }, null)
    )
    mockHostFromUrl.mockReturnValue(null)
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/x'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('host_required')
  })

  it('returns 404 when app row missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle(null, { message: 'not found' })
    )
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/x'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(404)
  })

  it('returns 502 indexnow_fetch_failed when submit throws', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle({ id: APP_ID, metadata: {} }, null)
    )
    mockHostFromUrl.mockReturnValue('example.com')
    mockSubmitUrlsToIndexNow.mockRejectedValue(new Error('ECONNRESET'))
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/x'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string; message: string } }
    expect(j.error.code).toBe('indexnow_fetch_failed')
    expect(j.error.message).toContain('ECONNRESET')
  })

  it('returns 502 when IndexNow rejects the payload', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle({ id: APP_ID, metadata: {} }, null)
    )
    mockHostFromUrl.mockReturnValue('example.com')
    mockSubmitUrlsToIndexNow.mockResolvedValue({
      ok: false,
      httpStatus: 400,
      responseText: 'bad',
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/x'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('indexnow_rejected')
  })

  it('returns 200 when IndexNow accepts and audit succeeds', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue(
      appSelectSingle({ id: APP_ID, metadata: {} }, null)
    )
    mockHostFromUrl.mockReturnValue('example.com')
    mockSubmitUrlsToIndexNow.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      responseText: '{}',
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['https://example.com/a', 'https://example.com/b'],
        key: '12345678',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      submitted: number
      host: string
    }
    expect(body.ok).toBe(true)
    expect(body.submitted).toBe(2)
    expect(body.host).toBe('example.com')
    expect(mockSubmitUrlsToIndexNow).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'example.com',
        key: '12345678',
        urlList: ['https://example.com/a', 'https://example.com/b'],
      })
    )
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
