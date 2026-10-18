import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCronBearerOk = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockEnqueueStaleArticles = vi.fn()
const mockProcessNextRefreshItem = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  cronBearerOk: (...args: unknown[]) => mockCronBearerOk(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/refresh-queue', () => ({
  enqueueStaleArticles: (...args: unknown[]) => mockEnqueueStaleArticles(...args),
  processNextRefreshItem: (...args: unknown[]) => mockProcessNextRefreshItem(...args),
}))

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

describe('GET /api/cron/refresh', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockEnqueueStaleArticles).not.toHaveBeenCalled()
  })

  it('returns 200 when there are no active apps', async () => {
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
    const body = (await res.json()) as { ok: boolean; message?: string }
    expect(body.ok).toBe(true)
    expect(body.message).toBe('No active apps')
  })

  it('runs enqueue + process for each active app', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: APP_ID, slug: 'my-app' }],
            error: null,
          }),
        }),
      })),
    })
    mockEnqueueStaleArticles.mockResolvedValue({ enqueued: 2, skipped: 1 })
    mockProcessNextRefreshItem.mockResolvedValue({
      slug: 'post-a',
      success: true,
    })

    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      results: Array<{
        app: string
        enqueued: number
        skipped: number
        processed: { slug: string; success: boolean } | null
      }>
    }
    expect(body.ok).toBe(true)
    expect(body.results).toHaveLength(1)
    expect(body.results[0].app).toBe('my-app')
    expect(body.results[0].enqueued).toBe(2)
    expect(body.results[0].skipped).toBe(1)
    expect(body.results[0].processed).toMatchObject({
      slug: 'post-a',
      success: true,
    })
    expect(mockEnqueueStaleArticles).toHaveBeenCalledWith(APP_ID)
    expect(mockProcessNextRefreshItem).toHaveBeenCalledWith(APP_ID)
  })
})
