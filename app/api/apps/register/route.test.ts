import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { POST } from './route'

const REGISTER_SECRET = 'register-secret-min-8'
const VALID_BODY = {
  slug: 'new-app',
  name: 'New App',
  register_secret: REGISTER_SECRET,
}

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost/api/apps/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/apps/register', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('returns 503 when SCP_REGISTER_SECRET is not configured', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', '')
    const res = await POST(jsonReq(VALID_BODY))
    expect(res.status).toBe(503)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('register_disabled')
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid JSON', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)
    const req = new NextRequest('http://localhost/api/apps/register', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 for invalid slug', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)
    const res = await POST(
      jsonReq({ ...VALID_BODY, slug: 'Bad_Slug', register_secret: REGISTER_SECRET })
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 401 for wrong register_secret', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)
    const res = await POST(
      jsonReq({ ...VALID_BODY, register_secret: 'wrong-secret-here' })
    )
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 409 when slug already exists', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'existing' } }),
      })),
    })
    const res = await POST(jsonReq(VALID_BODY))
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('slug_taken')
  })

  it('returns 200 and api_key on success', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)
    mockTryInsertUserAudit.mockResolvedValue(undefined)

    let appsFromCount = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          appsFromCount += 1
          if (appsFromCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: '550e8400-e29b-41d4-a716-446655440000',
                    slug: 'new-app',
                    name: 'New App',
                  },
                  error: null,
                }),
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (table === 'scp_api_keys') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: '660e8400-e29b-41d4-a716-446655440000' },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    })

    const res = await POST(jsonReq(VALID_BODY))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      app: { id: string; slug: string; name: string }
      api_key: string
      message: string
    }
    expect(body.app.slug).toBe('new-app')
    expect(body.api_key.startsWith('scp_')).toBe(true)
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('rolls back app when API key insert fails', async () => {
    vi.stubEnv('SCP_REGISTER_SECRET', REGISTER_SECRET)

    let appsFromCount = 0
    const eqMock = vi.fn().mockResolvedValue({ error: null })
    const deleteMock = vi.fn().mockReturnValue({ eq: eqMock })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          appsFromCount += 1
          if (appsFromCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: '550e8400-e29b-41d4-a716-446655440000',
                    slug: 'new-app',
                    name: 'New App',
                  },
                  error: null,
                }),
              }),
            }),
            delete: deleteMock,
          }
        }
        if (table === 'scp_api_keys') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'constraint' },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table: ${table}`)
      }),
    })

    const res = await POST(jsonReq(VALID_BODY))
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('key_insert_failed')
    expect(deleteMock).toHaveBeenCalled()
    expect(eqMock).toHaveBeenCalledWith('id', '550e8400-e29b-41d4-a716-446655440000')
  })
})
