import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqNotChain, buildThenableFluentChain } from '@/lib/testing/supabase-mocks'

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

function selectEqThenable(result: { data: unknown; error: unknown }) {
  return buildThenableFluentChain(['select', 'eq'], result)
}

describe('GET /api/v1/apps/[appId]/analytics/intent-breakdown', () => {
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

  it('returns 500 when keywords query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return selectEqThenable({ data: [], error: { message: 'db' } })
        }
        return buildSelectEqNotChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns breakdown for keywords and articles', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return selectEqThenable({
            data: [
              {
                intent_type: 'informational',
                status: 'active',
                search_volume: 1000,
                opportunity_score: 8,
              },
            ],
            error: null,
          })
        }
        if (table === 'scp_articles') {
          return buildSelectEqNotChain({
            data: [
              {
                intent_type: 'informational',
                status: 'published',
                gsc_clicks: 20,
                gsc_avg_position: 4,
              },
            ],
            error: null,
          })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      breakdown: Array<{ intent_type: string; keywords: { total: number } }>
    }
    const info = j.breakdown.find((b) => b.intent_type === 'informational')
    expect(info?.keywords.total).toBe(1)
  })
})
