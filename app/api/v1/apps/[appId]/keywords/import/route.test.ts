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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/keywords/import', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost([{ keyword: 'a' }]), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 when JSON body is not an array', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost({ keyword: 'x' }), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_body')
  })

  it('returns 400 for empty import', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost([]), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('empty_import')
  })

  it('returns 400 when too many rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = Array.from({ length: 5001 }, () => ({ keyword: 'k' }))
    const res = await POST(jsonPost(rows), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('too_many_rows')
  })

  it('returns 400 when no valid keywords after filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost([{ keyword: '   ' }, { volume: '1' }]), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('no_valid_keywords')
  })

  it('returns 200 and counts after upsert', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'k1',
                keyword: 'hello',
                intent_type: null,
                search_volume: null,
                difficulty: null,
              },
            ],
            error: null,
          }),
        }),
      })),
    })
    const res = await POST(
      jsonPost([{ keyword: 'Hello' }, { keyword: '' }]),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      imported: number
      total_rows: number
      skipped: number
    }
    expect(j.imported).toBe(1)
    expect(j.total_rows).toBe(2)
    expect(j.skipped).toBe(1)
  })
})
