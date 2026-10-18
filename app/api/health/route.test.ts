import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFrom, mockCreateAdminClient } = vi.hoisted(() => {
  const mockFrom = vi.fn()
  const mockCreateAdminClient = vi.fn(() => ({ from: mockFrom }))
  return { mockFrom, mockCreateAdminClient }
})

vi.mock('@/lib/supabase', () => ({
  createAdminClient: mockCreateAdminClient,
}))

vi.mock('@/lib/cron-auth', () => ({
  getCronSecret: vi.fn(() => undefined),
}))

import { GET } from './route'

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockResolvedValue({ count: 0, error: null }),
    }))
  })

  it('returns 200 and ok when all table probes succeed', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      service: string
      checks: Record<string, { ok: boolean }>
    }
    expect(body.ok).toBe(true)
    expect(body.service).toBe('seo-control-plane')
    expect(body.checks.scp_apps?.ok).toBe(true)
    expect(mockCreateAdminClient).toHaveBeenCalled()
  })

  it('returns ok false when a table is missing', async () => {
    mockFrom.mockImplementation((table: string) => ({
      select: vi.fn().mockResolvedValue(
        table === 'scp_apps'
          ? {
              count: 0,
              error: { message: 'relation "scp_apps" does not exist', code: '42P01' },
            }
          : { count: 0, error: null }
      ),
    }))

    const res = await GET()
    const body = (await res.json()) as {
      ok: boolean
      checks: Record<string, { ok: boolean; error?: string }>
    }
    expect(body.ok).toBe(false)
    expect(body.checks.scp_apps.ok).toBe(false)
    expect(body.checks.scp_apps.error).toContain('migrations')
  })
})
