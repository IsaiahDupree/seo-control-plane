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

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

function thenableResult<T>(value: T) {
  const p = Promise.resolve(value)
  return {
    eq: vi.fn().mockReturnValue(p),
    then: p.then.bind(p) as typeof p.then,
    catch: p.catch.bind(p) as typeof p.catch,
    finally: p.finally.bind(p) as typeof p.finally,
  }
}

describe('/api/v1/apps/[appId]/context/history', () => {
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

  it('returns history and summary', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = [
      {
        id: '1',
        sync_type: 'product',
        version: 2,
        snapshot: {},
        performed_by: null,
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: '2',
        sync_type: 'product',
        version: 1,
        snapshot: {},
        performed_by: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const limitResult = thenableResult({ data: rows, error: null })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(limitResult),
            }),
          }),
        }),
      })),
    })

    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history).toHaveLength(2)
    expect(body.summary.product.latest_version).toBe(2)
  })

  it('filters by type when ?type= is set', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const rows = [
      {
        id: '1',
        sync_type: 'ctas',
        version: 1,
        snapshot: {},
        performed_by: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const limitResult = thenableResult({ data: rows, error: null })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(limitResult),
            }),
          }),
        }),
      })),
    })

    const res = await GET(new NextRequest('http://localhost/?type=ctas'), ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).history).toHaveLength(1)
    expect(limitResult.eq).toHaveBeenCalledWith('sync_type', 'ctas')
  })
})
