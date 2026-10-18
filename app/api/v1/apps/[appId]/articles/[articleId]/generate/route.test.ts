import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import {
  buildSelectEqEqMaybeSingleChain,
  buildUpdateEqThenChain,
} from '@/lib/testing/supabase-mocks'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const ARTICLE_ID = '770e8400-e29b-41d4-a716-446655440005'

function ctx() {
  return {
    params: Promise.resolve({ appId: APP_ID, articleId: ARTICLE_ID }),
  }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/articles/[articleId]/generate', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 404 when article missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(404)
  })

  it('returns 409 when status not eligible without force', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: ARTICLE_ID,
            slug: 's',
            title: 'T',
            status: 'published',
            brief_id: null,
            focus_keyword: 'k',
            target_word_count: 100,
          },
          error: null,
        })
      ),
    })
    const res = await POST(jsonPost({ force: false }), ctx())
    expect(res.status).toBe(409)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_status')
  })

  it('creates job and sets article to generating', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let articlesFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_articles') {
          articlesFrom += 1
          if (articlesFrom === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: ARTICLE_ID,
                slug: 's',
                title: 'T',
                status: 'draft',
                brief_id: 'b1',
                focus_keyword: 'k',
                target_word_count: 500,
              },
              error: null,
            })
          }
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_generation_jobs') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'job-uuid-1' },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(
      jsonPost({ provider: 'openai', model: 'gpt-4' }),
      ctx()
    )
    expect(res.status).toBe(202)
    const j = (await res.json()) as {
      generation_job_id: string
      status: string
    }
    expect(j.generation_job_id).toBe('job-uuid-1')
    expect(j.status).toBe('pending')
  })
})
