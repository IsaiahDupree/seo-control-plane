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

describe('GET /api/cron/performance-alerts', () => {
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

  it('returns summary when no active apps', async () => {
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
      apps_checked: number
      alerts_generated: number
      alerts: unknown[]
    }
    expect(j.apps_checked).toBe(0)
    expect(j.alerts_generated).toBe(0)
    expect(j.alerts).toEqual([])
  })
})
