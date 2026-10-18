import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { DELETE, GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/context/competitor-sites', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'db' },
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns competitors list', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'c1',
                  domain: 'rival.com',
                  label: 'Rival',
                  track_serp: true,
                  notes: null,
                  created_at: '2026-01-01',
                },
              ],
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      competitors: Array<{ domain: string }>
    }
    expect(j.competitors).toHaveLength(1)
    expect(j.competitors[0].domain).toBe('rival.com')
  })
})

describe('POST /api/v1/apps/[appId]/context/competitor-sites', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for empty competitors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ competitors: [] }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 201 after upsert', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'x', domain: 'a.com', label: 'A', track_serp: true }],
            error: null,
          }),
        }),
      })),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          competitors: [{ domain: 'a.com', label: 'A', track_serp: true }],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const j = (await res.json()) as { count: number }
    expect(j.count).toBe(1)
  })

  it('returns 500 when upsert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'conflict' },
          }),
        }),
      })),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({
          competitors: [{ domain: 'b.com' }],
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('insert_failed')
  })
})

describe('DELETE /api/v1/apps/[appId]/context/competitor-sites', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when domain missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await DELETE(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('missing_param')
  })

  it('deletes by domain', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      })),
    })
    const res = await DELETE(
      new NextRequest('http://localhost/?domain=evil.com'),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { deleted: string }
    expect(j.deleted).toBe('evil.com')
  })
})
