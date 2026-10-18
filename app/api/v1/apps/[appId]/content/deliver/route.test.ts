import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockDeliverArticle = vi.fn()
const mockCreateAdminClient = vi.fn()
const mockTryInsertUserAudit = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/deliver', () => ({
  deliverArticle: (...args: unknown[]) => mockDeliverArticle(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/user-audit', () => ({
  tryInsertUserAudit: (...args: unknown[]) => mockTryInsertUserAudit(...args),
}))

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function routeContext() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/content/deliver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAdminClient.mockReturnValue({})
  })

  it('returns 401 when auth gate fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'Invalid or missing API key for this app'),
    })
    const req = new NextRequest('http://localhost/api/v1/apps/x/content/deliver', {
      method: 'POST',
      body: JSON.stringify({ article_id: ARTICLE_ID }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(401)
    expect(mockDeliverArticle).not.toHaveBeenCalled()
  })

  it('returns 400 invalid_json for non-JSON body', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_json')
  })

  it('returns 400 validation_error for bad article_id', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_id: 'not-a-uuid' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation_error')
  })

  it('returns 404 when deliverArticle reports not found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockDeliverArticle.mockResolvedValue({
      success: false,
      error: 'Article not found',
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_id: ARTICLE_ID }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(404)
    expect(mockDeliverArticle).toHaveBeenCalledWith(ARTICLE_ID, APP_ID)
  })

  it('returns 200 with delivery payload on success', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockDeliverArticle.mockResolvedValue({
      success: true,
      deliveryId: '770e8400-e29b-41d4-a716-446655440000',
    })
    mockTryInsertUserAudit.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ article_id: ARTICLE_ID }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, routeContext())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      delivery_id: string
      article_id: string
      status: string
    }
    expect(body.status).toBe('delivered')
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(body.delivery_id).toBe('770e8400-e29b-41d4-a716-446655440000')
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
