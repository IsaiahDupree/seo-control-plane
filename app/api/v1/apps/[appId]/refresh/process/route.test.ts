import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockProcessNextRefreshItem = vi.fn()

vi.mock('@/lib/refresh-queue', () => ({
  processNextRefreshItem: (...args: unknown[]) => mockProcessNextRefreshItem(...args),
}))

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

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '660e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/refresh/process', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 200 with processed false when queue empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockProcessNextRefreshItem.mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { processed: boolean; message?: string }
    expect(body.processed).toBe(false)
    expect(body.message).toContain('empty')
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 200 with processed true and records audit on success', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockProcessNextRefreshItem.mockResolvedValue({
      article_id: ARTICLE_ID,
      slug: 'my-post',
      success: true,
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      processed: boolean
      article_id: string
      slug: string
      success: boolean
      error: null
    }
    expect(body.processed).toBe(true)
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(body.success).toBe(true)
    expect(body.error).toBeNull()
    expect(mockTryInsertUserAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'refresh.processed',
        entity_id: ARTICLE_ID,
      })
    )
  })

  it('returns 200 with success false when processor reports error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockProcessNextRefreshItem.mockResolvedValue({
      article_id: ARTICLE_ID,
      slug: '',
      success: false,
      error: 'Article not found',
    })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; error: string | null }
    expect(body.success).toBe(false)
    expect(body.error).toBe('Article not found')
  })
})
