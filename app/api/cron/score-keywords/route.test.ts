import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCronBearerOk = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  cronBearerOk: (...args: unknown[]) => mockCronBearerOk(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

function keywordsChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

function articlesInChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

describe('GET /api/cron/score-keywords', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 500 when keyword query fails', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        keywordsChain({ data: null, error: { message: 'db down' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(500)
  })

  it('returns scored 0 when no keywords', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        keywordsChain({ data: [], error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { scored: number; message?: string }
    expect(j.scored).toBe(0)
    expect(j.message).toBe('No active keywords with volume data')
  })

  it('scores keywords and updates rows', async () => {
    mockCronBearerOk.mockReturnValue(true)
    let kwFrom = 0
    let articlesFrom = 0
    let updateCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_keywords') {
          kwFrom += 1
          if (kwFrom === 1) {
            return keywordsChain({
              data: [
                {
                  id: 'k1',
                  app_id: 'a1',
                  keyword: 'hello world',
                  search_volume: 100,
                  difficulty: 50,
                  intent_type: 'informational',
                },
              ],
              error: null,
            })
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation(() => {
                updateCalls += 1
                return Promise.resolve({ error: null })
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          articlesFrom += 1
          return articlesInChain({ data: [], error: null })
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { scored: number; total: number }
    expect(j.total).toBe(1)
    expect(j.scored).toBe(1)
    expect(updateCalls).toBe(1)
    expect(articlesFrom).toBe(1)
  })
})
