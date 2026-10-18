import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildSelectEqOrderChain,
} from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

const articleRow = {
  id: ARTICLE_ID,
  slug: 'post',
  title: 'T',
  focus_keyword: 'kw',
}

describe('GET /api/v1/apps/[appId]/articles/[articleId]/competitors', () => {
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

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(404)
  })

  it('returns competitor rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let fromCalls = 0
    const comp = {
      id: 'c1',
      domain: 'rival.com',
      url: 'https://rival.com/p',
      title: 'R',
      position: 3,
      estimated_traffic: 100,
      word_count: 800,
      captured_at: '2026-01-01',
    }
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCalls += 1
        if (fromCalls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: articleRow,
            error: null,
          })
        }
        return buildSelectEqOrderChain({ data: [comp], error: null })
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { competitors: typeof comp[] }
    expect(j.competitors).toHaveLength(1)
    expect(j.competitors[0].domain).toBe('rival.com')
  })
})

describe('POST /api/v1/apps/[appId]/articles/[articleId]/competitors', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitor_pages: [] }),
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('upserts competitor pages and returns stored count', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: [
              { id: 'n1', domain: 'd.com', url: 'https://d.com/u', position: 2 },
            ],
            error: null,
          }),
        }),
      })),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitor_pages: [
            { domain: 'd.com', url: 'https://d.com/u', position: 2 },
          ],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(201)
    const j = (await res.json()) as { stored: number }
    expect(j.stored).toBe(1)
  })
})
