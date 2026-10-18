import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { GET, PATCH } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

const appRow = {
  id: APP_ID,
  slug: 'my-app',
  name: 'My App',
  base_url: 'https://example.com',
  domain: null,
  webhook_url: null,
  context: {},
  metadata: {},
  plan: 'pro',
  status: 'active',
  monthly_article_limit: 50,
  monthly_articles_generated: 0,
  quota_reset_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

describe('/api/v1/apps/[appId]/settings', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(401)
    })

    it('returns 404 when app is missing', async () => {
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
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 with app payload', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: appRow, error: null }),
            }),
          }),
        })),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { app: { name: string } }
      expect(body.app.name).toBe('My App')
    })
  })

  describe('PATCH', () => {
    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: 'x',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 when webhook_secret is too short', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ webhook_secret: 'short' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('validation_error')
    })

    it('returns 404 when app row missing', async () => {
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
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 and merges context on patch', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)

      const existing = {
        id: APP_ID,
        name: 'Old',
        base_url: null,
        domain: null,
        webhook_url: null,
        context: { keep: true },
        metadata: {},
        monthly_article_limit: 10,
      }
      const updated = {
        id: APP_ID,
        slug: 'my-app',
        name: 'Old',
        base_url: null,
        domain: null,
        webhook_url: null,
        context: { keep: true, newKey: 'v' },
        metadata: {},
        plan: 'pro',
        status: 'active',
        monthly_article_limit: 10,
        updated_at: '2026-06-01T00:00:00Z',
      }

      let appsFrom = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          appsFrom += 1
          if (appsFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
                }),
              }),
            }
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: updated, error: null }),
                }),
              }),
            }),
          }
        }),
      })

      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ context: { newKey: 'v' } }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { app: { context: Record<string, unknown> } }
      expect(body.app.context).toEqual({ keep: true, newKey: 'v' })
      expect(mockTryInsertUserAudit).toHaveBeenCalled()
    })
  })
})
