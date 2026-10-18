import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import { expectJson, expectJsonError } from '@/lib/testing/http-contracts'
import {
  buildSelectEqEqSingleChain,
  buildSelectEqSingleChain,
} from '@/lib/testing/supabase-mocks'

const mockRunArticleGeneration = vi.fn()

vi.mock('@/lib/generation-pipeline', () => ({
  runArticleGeneration: (...args: unknown[]) => mockRunArticleGeneration(...args),
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
const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

const appRow = {
  id: APP_ID,
  slug: 'app',
  name: 'App',
  context: {},
  metadata: {},
  monthly_article_limit: 50,
}

const genResult = {
  article_id: ARTICLE_ID,
  slug: 'my-article',
  title: 'Title',
  word_count: 500,
  reading_time_minutes: 2,
  qa: {
    score: 8,
    outcome: 'pass',
    blocking_issues: [] as string[],
    warnings: [] as string[],
  },
  generation: { model: 'gpt-4', tokens: 1000, cost_usd: 0.02 },
  delivery: null as { success: boolean; deliveryId: string } | null,
}

describe('POST /api/v1/apps/[appId]/generate', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ focus_keyword: 'seo' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 401, code: 'unauthorized' })
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: 'x',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'invalid_json' })
  })

  it('returns 400 when neither brief_id nor focus_keyword', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ content_type: 'cluster' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 400, code: 'validation_error' })
  })

  it('returns 404 when app missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqSingleChain({ data: null, error: null })
      ),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ focus_keyword: 'seo tips' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 404, code: 'app_not_found' })
  })

  it('returns 404 brief_not_found when brief_id invalid', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        n += 1
        if (n === 1) {
          return buildSelectEqSingleChain({ data: appRow, error: null })
        }
        return buildSelectEqEqSingleChain({ data: null, error: null })
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ brief_id: BRIEF_ID }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 404, code: 'brief_not_found' })
  })

  it('returns 200 with focus_keyword path', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockRunArticleGeneration.mockResolvedValue(genResult)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqSingleChain({ data: appRow, error: null })
      ),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ focus_keyword: 'seo tips' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    const body = await expectJson(
      res,
      z.object({
        article_id: z.string(),
        slug: z.string(),
        title: z.string(),
      }),
      { status: 200 }
    )
    expect(body.article_id).toBe(ARTICLE_ID)
    expect(body.slug).toBe('my-article')
    expect(mockRunArticleGeneration).toHaveBeenCalled()
    expect(mockTryInsertUserAudit).toHaveBeenCalled()
  })

  it('returns 429 when monthly limit exceeded', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockRunArticleGeneration.mockRejectedValue(
      new MonthlyArticleLimitExceededError(50, 50)
    )
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqSingleChain({ data: appRow, error: null })
      ),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ focus_keyword: 'xx' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJsonError(res, { status: 429, code: 'monthly_limit_exceeded' })
  })

  it('returns 200 when brief_id loads pending brief', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockTryInsertUserAudit.mockResolvedValue(undefined)
    mockRunArticleGeneration.mockResolvedValue(genResult)
    const briefRow = {
      id: BRIEF_ID,
      status: 'pending',
      focus_keyword: 'kw',
      secondary_keywords: [],
      content_type: 'cluster',
      cluster_name: null,
      target_word_count: 1800,
      target_persona: null,
      tone_notes: null,
      cta_guidance: null,
      content_request_id: null,
    }
    let n = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        n += 1
        if (table === 'scp_apps') {
          return buildSelectEqSingleChain({ data: appRow, error: null })
        }
        if (table === 'scp_content_briefs') {
          return buildSelectEqEqSingleChain({ data: briefRow, error: null })
        }
        throw new Error(`unexpected ${table} at ${n}`)
      }),
    })
    const req = new NextRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ brief_id: BRIEF_ID }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, ctx())
    await expectJson(
      res,
      z.object({ article_id: z.string(), slug: z.string() }),
      { status: 200 }
    )
    expect(mockRunArticleGeneration).toHaveBeenCalledWith(
      APP_ID,
      expect.any(Object),
      expect.objectContaining({ brief_id: BRIEF_ID, focus_keyword: 'kw' })
    )
  })
})
