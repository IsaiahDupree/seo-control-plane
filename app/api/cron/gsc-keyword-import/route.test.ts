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

function gscPerformanceChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        gte: vi.fn().mockReturnValue({
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(result),
              }),
            }),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/cron/gsc-keyword-import', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 500 when apps query fails', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: { message: 'db' } }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(500)
  })

  it('returns zeros when no active apps', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      apps_processed: number
      total_imported: number
    }
    expect(j.apps_processed).toBe(0)
    expect(j.total_imported).toBe(0)
  })

  it('imports new keywords from GSC rows', async () => {
    mockCronBearerOk.mockReturnValue(true)
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const appId = '550e8400-e29b-41d4-a716-446655440000'
    let kwFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: appId }],
                error: null,
              }),
            }),
          }
        }
        if (table === 'scp_gsc_performance') {
          return gscPerformanceChain({
            data: [
              {
                query: 'Fresh GSC Query',
                avg_position: 12,
                impressions: 80,
                clicks: 1,
                ctr: 0.01,
                date: '2026-01-01',
              },
            ],
            error: null,
          })
        }
        if (table === 'scp_keywords') {
          kwFrom += 1
          if (kwFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }
          }
          return { upsert }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      total_imported: number
      per_app: Array<{ app_id: string; imported: number }>
    }
    expect(j.total_imported).toBe(1)
    expect(j.per_app[0].imported).toBe(1)
    expect(upsert).toHaveBeenCalled()
  })
})
