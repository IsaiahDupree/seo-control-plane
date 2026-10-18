import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockGetAppSummaryPayload = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/dashboard-metrics', () => ({
  getAppSummaryPayload: (...args: unknown[]) => mockGetAppSummaryPayload(...args),
}))

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('GET /api/v1/apps/[appId]/dashboard/summary', () => {
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

  it('returns 404 when app payload missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockGetAppSummaryPayload.mockResolvedValue({ error: 'App not found' })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_found')
    expect(mockGetAppSummaryPayload).toHaveBeenCalledWith(
      expect.anything(),
      APP_ID
    )
  })

  it('returns 200 with summary payload', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const admin = { from: vi.fn() }
    mockCreateAdminClient.mockReturnValue(admin)
    mockGetAppSummaryPayload.mockResolvedValue({
      app: {
        id: APP_ID,
        slug: 'app',
        name: 'App',
        plan: 'pro',
        status: 'active',
        monthly_article_limit: 50,
        monthly_unlimited: false,
        base_url: 'https://example.com',
        webhook_configured: true,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
      },
      usage: { articles_this_utc_month: 2, monthly_remaining: 48 },
      metrics: {
        unassigned_keywords: 1,
        pending_briefs: 0,
        open_content_requests: 0,
        processing_content_requests: 0,
        articles_approved: 2,
        articles_queued: 0,
      },
      generated_at: '2026-01-03T00:00:00Z',
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { app: { slug: string }; usage: { monthly_remaining: number } }
    expect(body.app.slug).toBe('app')
    expect(body.usage.monthly_remaining).toBe(48)
  })
})
