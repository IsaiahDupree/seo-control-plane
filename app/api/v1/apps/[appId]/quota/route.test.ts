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

describe('/api/v1/apps/[appId]/quota', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('GET returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(401)
  })

  it('GET returns 404 when app missing', async () => {
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

  it('GET returns quota snapshot', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: APP_ID,
                plan: 'pro',
                monthly_article_limit: 30,
                monthly_articles_generated: 10,
                quota_reset_at: '2026-02-01T00:00:00Z',
              },
              error: null,
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.monthly_remaining).toBe(20)
    expect(body.plan).toBe('pro')
  })

  it('PATCH returns 400 when monthly_article_limit invalid', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'PATCH',
      body: JSON.stringify({ monthly_article_limit: -1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(400)
  })

  it('PATCH updates quota and audits', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: APP_ID,
                  monthly_article_limit: 100,
                  monthly_articles_generated: 5,
                  quota_reset_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      })),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'PATCH',
      body: JSON.stringify({ monthly_article_limit: 100 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, ctx())
    expect(res.status).toBe(200)
    expect((await res.json()).quota.monthly_article_limit).toBe(100)
    expect(mockTryInsertUserAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'quota.overridden' })
    )
  })
})
