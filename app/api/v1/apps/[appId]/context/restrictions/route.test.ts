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

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/context/restrictions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns null restrictions when missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).restrictions).toBeNull()
  })

  it('POST upserts, bumps version, and logs sync', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const insert = vi.fn().mockResolvedValue({ error: null })
    let restrictionsFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_app_sync_logs') {
          return { insert }
        }
        if (table === 'scp_app_restrictions') {
          restrictionsFrom += 1
          if (restrictionsFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { version: 0 }, error: null }),
                }),
              }),
            }
          }
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { app_id: APP_ID, version: 1, competitor_mention_policy: 'allow' },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ competitor_mention_policy: 'allow' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: APP_ID,
        sync_type: 'restrictions',
        version: 1,
      })
    )
  })
})
