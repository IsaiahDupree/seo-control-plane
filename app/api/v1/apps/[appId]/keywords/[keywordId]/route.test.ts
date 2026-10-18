import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqEqSelectSingleChain,
} from '@/lib/testing/supabase-mocks'

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
const KW_ID = '660e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440000'

const keywordRow = {
  id: KW_ID,
  keyword: 'seo',
  cluster_name: null,
  status: 'unassigned',
  search_volume: null,
  difficulty: null,
  intent: null,
  priority_score: null,
  is_seed: false,
  article_id: null,
  last_refreshed_at: null,
  created_at: '2026-01-01T00:00:00Z',
}

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, keywordId: KW_ID }) }
}

describe('/api/v1/apps/[appId]/keywords/[keywordId]', () => {
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

    it('returns 404 when keyword missing', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(404)
    })

    it('returns 200 with keyword', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() =>
          buildSelectEqEqMaybeSingleChain({ data: keywordRow, error: null })
        ),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { keyword: { keyword: string } }
      expect(body.keyword.keyword).toBe('seo')
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

    it('returns 400 when body empty', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 article_mismatch when article_id not in app', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: KW_ID,
                cluster_name: null,
                status: 'unassigned',
                priority_score: null,
                is_seed: false,
                article_id: null,
              },
              error: null,
            })
          }
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ article_id: ARTICLE_ID }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(400)
      const j = (await res.json()) as { error: { code: string } }
      expect(j.error.code).toBe('article_mismatch')
    })

    it('returns 200 when patch succeeds without article_id', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockTryInsertUserAudit.mockResolvedValue(undefined)
      let n = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => {
          n += 1
          if (n === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: KW_ID,
                cluster_name: null,
                status: 'unassigned',
                priority_score: 1,
                is_seed: false,
                article_id: null,
              },
              error: null,
            })
          }
          return buildUpdateEqEqSelectSingleChain({
            data: { ...keywordRow, priority_score: 9 },
            error: null,
          })
        }),
      })
      const req = new NextRequest('http://localhost/', {
        method: 'PATCH',
        body: JSON.stringify({ priority_score: 9 }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await PATCH(req, ctx())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { keyword: { priority_score: number } }
      expect(body.keyword.priority_score).toBe(9)
    })
  })
})
