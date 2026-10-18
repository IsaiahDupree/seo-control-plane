import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function experimentsChain(result: { data: unknown; error: unknown }) {
  return buildThenableFluentChain(
    ['select', 'eq', 'order', 'limit'],
    result
  )
}

function articlesInChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/experiment-results', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ error: jsonError(401, 'unauthorized', 'nope') })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 500 when query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_experiments') return experimentsChain({ data: null, error: { message: 'db' } })
        return articlesInChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=10'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns aggregates and enriched experiments', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_experiments') {
          return experimentsChain(
            {
              data: [
                { id: 'e1', article_id: 'a1', variant_name: 'A', hypothesis: 'H', status: 'active', winner: null, started_at: '2026-01-01', concluded_at: null, metrics: {} },
                { id: 'e2', article_id: 'a1', variant_name: 'B', hypothesis: 'H', status: 'concluded', winner: 'B', started_at: '2026-01-02', concluded_at: '2026-01-03', metrics: { uplift: 0.1 } },
              ],
              error: null,
            }
          )
        }
        return articlesInChain({ data: [{ id: 'a1', slug: 'one', title: 'One' }], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=30'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total: number
      active: number
      concluded: number
      with_winner: number
      experiments: Array<{ experiment_id: string; slug: string | null; winner: string | null }>
    }
    expect(j.total).toBe(2)
    expect(j.active).toBe(1)
    expect(j.concluded).toBe(1)
    expect(j.with_winner).toBe(1)
    expect(j.experiments[0].slug).toBe('one')
  })

  it('applies status filter when provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_experiments') return experimentsChain({ data: [], error: null })
        return articlesInChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?status=active'), ctx())
    expect(res.status).toBe(200)
  })
})

