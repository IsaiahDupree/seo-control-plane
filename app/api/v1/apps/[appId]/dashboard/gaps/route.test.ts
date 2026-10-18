import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildHeadCountChain } from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockGetAppOperationalMetrics = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/dashboard-metrics', () => ({
  getAppOperationalMetrics: (...args: unknown[]) =>
    mockGetAppOperationalMetrics(...args),
}))

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

const metrics = {
  unassigned_keywords: 3,
  pending_briefs: 1,
  open_content_requests: 2,
  processing_content_requests: 0,
  articles_approved: 4,
  articles_queued: 1,
}

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/dashboard/gaps', () => {
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

  it('returns 500 when open-request count query fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockGetAppOperationalMetrics.mockResolvedValue(metrics)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildHeadCountChain({ count: null, error: { message: 'rls' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns 200 with gaps, open_content_requests, and metrics', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockGetAppOperationalMetrics.mockResolvedValue(metrics)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        expect(table).toBe('scp_content_requests')
        return buildHeadCountChain({ count: 7, error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      gaps: unknown[]
      open_content_requests: number
      metrics: typeof metrics
      generated_at: string
    }
    expect(body.gaps).toEqual([])
    expect(body.open_content_requests).toBe(7)
    expect(body.metrics.unassigned_keywords).toBe(3)
    expect(body.generated_at).toMatch(/^\d{4}-/)
  })
})
