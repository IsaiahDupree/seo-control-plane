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

function articlesStaleChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/cron/refresh-stale-articles', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 500 when article query fails', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        articlesStaleChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(500)
  })

  it('returns message when no stale articles', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => articlesStaleChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { queued: number; message?: string }
    expect(j.queued).toBe(0)
    expect(j.message).toBe('No stale articles found')
  })

  it('queues stale articles not already in refresh queue', async () => {
    mockCronBearerOk.mockReturnValue(true)
    const oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const articleId = '660e8400-e29b-41d4-a716-446655440001'
    const appId = '550e8400-e29b-41d4-a716-446655440000'
    let refreshFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          return articlesStaleChain({
            data: [
              {
                id: articleId,
                app_id: appId,
                slug: 'old-post',
                gsc_avg_position: 15,
                published_at: oldDate,
              },
            ],
            error: null,
          })
        }
        if (table === 'scp_refresh_queue') {
          refreshFrom += 1
          if (refreshFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  in: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }
          }
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: 'q1' }],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { queued: number; total_stale_found: number }
    expect(j.queued).toBe(1)
    expect(j.total_stale_found).toBe(1)
  })
})
