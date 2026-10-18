import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCronBearerOk = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  cronBearerOk: (req: NextRequest) => mockCronBearerOk(req),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

function generationJobsChain(rows: unknown[]) {
  return {
    update: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function refreshDeleteChain(rows: unknown[]) {
  return {
    delete: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

function publishQueueChain(rows: unknown[]) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        lt: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    }),
  }
}

describe('GET /api/cron/cleanup-expired', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('runs all cleanup steps when authorized', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_generation_jobs') {
          return generationJobsChain([{ id: 'j1' }])
        }
        if (table === 'scp_refresh_queue') {
          return refreshDeleteChain([{ id: 'r1' }])
        }
        if (table === 'scp_publish_queue') {
          return publishQueueChain([{ id: 'p1' }])
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      stale_jobs_failed: number
      stale_refresh_deleted: number
      expired_queue_items: number
    }
    expect(j.stale_jobs_failed).toBe(1)
    expect(j.stale_refresh_deleted).toBe(1)
    expect(j.expired_queue_items).toBe(1)
  })
})
