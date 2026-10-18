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

function keywordsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

function articlesChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockReturnValue({
          not: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

describe('GET /api/v1/apps/[appId]/analytics/coverage-heatmap', () => {
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

  it('returns 500 when keyword query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') return keywordsChain({ data: null, error: { message: 'db' } })
        return articlesChain({ data: [], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('query_failed')
  })

  it('returns cluster x intent heatmap with coverage statuses', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          return keywordsChain({
            data: [
              { cluster_name: 'C1', intent_type: 'informational', status: 'active' },
              { cluster_name: 'C1', intent_type: 'commercial', status: 'active' },
              { cluster_name: 'C2', intent_type: 'informational', status: 'inactive' },
            ],
            error: null,
          })
        }
        return articlesChain({
          data: [
            { cluster_name: 'C1', intent_type: 'informational', status: 'published' },
            { cluster_name: 'C1', intent_type: 'commercial', status: 'draft' },
          ],
          error: null,
        })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      clusters: number
      intents: string[]
      heatmap: Array<{ cluster_name: string; cells: Array<{ intent_type: string; keywords: number; articles: number; coverage: string }> }>
    }
    expect(j.intents).toContain('informational')
    expect(j.heatmap.length).toBeGreaterThan(0)
    const c1 = j.heatmap.find((r) => r.cluster_name === 'C1')
    expect(c1).toBeTruthy()
    const infoCell = c1!.cells.find((c) => c.intent_type === 'informational')
    expect(infoCell?.keywords).toBe(1)
    expect(infoCell?.articles).toBe(1)
  })
})

