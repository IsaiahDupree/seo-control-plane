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

function thenCount(count: number) {
  const p = Promise.resolve({ count, error: null })
  return { then: p.then.bind(p) as typeof p.then }
}

function healthAdmin() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_apps') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: APP_ID,
                  name: 'App',
                  status: 'active',
                  webhook_url: null,
                  created_at: '2026-01-01T00:00:00Z',
                  updated_at: '2026-01-02T00:00:00Z',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'scp_app_sync_logs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ sync_type: 'product', version: 1, created_at: '2026-01-03T00:00:00Z' }],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(thenCount(2)),
            }),
          }),
        }
      }
      if (table === 'scp_briefs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(thenCount(1)),
            }),
          }),
        }
      }
      if (table === 'scp_deliveries') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_app_features') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'f' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'scp_app_personas') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(thenCount(2)),
          }),
        }
      }
      if (table === 'scp_app_ctas') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue(thenCount(1)),
          }),
        }
      }
      if (table === 'scp_app_restrictions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'r' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'scp_app_publishing') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p' }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`unexpected ${table}`)
    }),
  }
}

describe('/api/v1/apps/[appId]/health GET', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/?skip_webhook=true'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when app missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/?skip_webhook=true'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns health payload with skip_webhook', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(healthAdmin())
    const res = await GET(new NextRequest('http://localhost/?skip_webhook=true'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.health.app_id).toBe(APP_ID)
    expect(body.health.context.score).toBe(90)
    expect(body.health.webhook.skipped).toBe(true)
    expect(body.health.queue.pending_articles).toBe(2)
  })

  it('returns 503 when app status is not active', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: APP_ID,
                    name: 'App',
                    status: 'suspended',
                    webhook_url: null,
                    created_at: '2026-01-01T00:00:00Z',
                    updated_at: '2026-01-02T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return healthAdmin().from(table)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/?skip_webhook=true'), ctx())
    expect(res.status).toBe(503)
  })
})
