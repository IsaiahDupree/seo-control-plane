import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'

const mockExecuteBriefGeneration = vi.fn()

vi.mock('@/lib/execute-brief-generation', () => ({
  executeBriefGeneration: (...args: unknown[]) => mockExecuteBriefGeneration(...args),
  AppNotFoundError: class AppNotFoundError extends Error {
    constructor(m: string) {
      super(m)
      this.name = 'AppNotFoundError'
    }
  },
  BriefNotFoundError: class BriefNotFoundError extends Error {
    constructor(m: string) {
      super(m)
      this.name = 'BriefNotFoundError'
    }
  },
  BriefNotPendingError: class BriefNotPendingError extends Error {
    constructor(m: string) {
      super(m)
      this.name = 'BriefNotPendingError'
    }
  },
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

import {
  AppNotFoundError,
  BriefNotFoundError,
  BriefNotPendingError,
} from '@/lib/execute-brief-generation'
import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, briefId: BRIEF_ID }) }
}

const genResult = {
  article_id: ARTICLE_ID,
  slug: 'from-brief',
  title: 'T',
  word_count: 400,
  reading_time_minutes: 2,
  qa: {
    score: 7,
    outcome: 'pass',
    blocking_issues: [] as string[],
    warnings: [] as string[],
  },
  generation: { model: 'gpt-4', tokens: 800, cost_usd: 0.01 },
  delivery: null as { success: boolean; deliveryId: string } | null,
}

describe('POST /api/v1/apps/[appId]/briefs/[briefId]/generate', () => {
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

  it('returns 400 for invalid JSON body', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 400 when target_word_count too low', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ target_word_count: 100 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    expect(res.status).toBe(400)
  })

  it('returns 404 app_not_found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockExecuteBriefGeneration.mockRejectedValue(new AppNotFoundError('missing'))
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('app_not_found')
  })

  it('returns 404 brief_not_found', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockExecuteBriefGeneration.mockRejectedValue(new BriefNotFoundError('nope'))
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('brief_not_found')
  })

  it('returns 409 brief_not_pending', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockExecuteBriefGeneration.mockRejectedValue(new BriefNotPendingError('busy'))
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('brief_not_pending')
  })

  it('returns 429 when monthly limit exceeded', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockExecuteBriefGeneration.mockRejectedValue(
      new MonthlyArticleLimitExceededError(10, 10)
    )
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(429)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('monthly_limit_exceeded')
  })

  it('returns 200 on success', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockExecuteBriefGeneration.mockResolvedValue(genResult)
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    const res = await POST(new NextRequest('http://localhost/', { method: 'POST' }), ctx())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { article_id: string; slug: string }
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(body.slug).toBe('from-brief')
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })
})
