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

function thenCount(count: number) {
  const p = Promise.resolve({ count, error: null })
  return { then: p.then.bind(p) as typeof p.then }
}

function deliveriesListMock(rows: unknown[]) {
  const final = Promise.resolve({ data: rows, error: null })
  const afterSecondEq = final
  const afterFirstEq = {
    eq: vi.fn().mockReturnValue(afterSecondEq),
    then: final.then.bind(final) as typeof final.then,
    catch: final.catch.bind(final) as typeof final.catch,
  }
  const afterLimit = {
    eq: vi.fn().mockReturnValue(afterFirstEq),
    then: final.then.bind(final) as typeof final.then,
    catch: final.catch.bind(final) as typeof final.catch,
  }
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue(afterLimit),
        }),
      }),
    }),
  }
}

describe('/api/v1/apps/[appId]/webhook/deliveries GET', () => {
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

  it('returns deliveries and summary counts', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let deliveriesFromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_deliveries') {
          deliveriesFromCalls += 1
          if (deliveriesFromCalls === 1) {
            return deliveriesListMock([{ id: 'd1', status: 'delivered', article_id: 'a1' }])
          }
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(thenCount(deliveriesFromCalls === 2 ? 10 : deliveriesFromCalls === 3 ? 2 : 1)),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deliveries).toHaveLength(1)
    expect(body.summary.delivered).toBe(10)
    expect(body.summary.failed).toBe(2)
    expect(body.summary.pending).toBe(1)
  })
})
