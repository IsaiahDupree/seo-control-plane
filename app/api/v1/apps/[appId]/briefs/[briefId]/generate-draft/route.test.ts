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
const BRIEF_ID = '660e8400-e29b-41d4-a716-446655440001'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID, briefId: BRIEF_ID }) }
}

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/briefs/[briefId]/generate-draft', () => {
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

  it('returns 400 for validation error', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost({ provider: 'azure' }), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 404 when brief missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('not_found')
  })

  it('returns 409 when status not eligible and force false', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({
          data: {
            id: BRIEF_ID,
            status: 'draft',
            article_id: null,
            content_request_id: null,
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

  it('returns 500 when job insert fails', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_content_briefs') {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: BRIEF_ID,
              status: 'approved',
              article_id: null,
              content_request_id: null,
            },
            error: null,
          })
        }
        if (table === 'scp_generation_jobs') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'rls' },
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('job_create_failed')
  })

  it('returns 202 and enqueues job when eligible', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_content_briefs') {
          calls += 1
          if (calls === 1) {
            return buildSelectEqEqMaybeSingleChain({
              data: {
                id: BRIEF_ID,
                status: 'ready',
                article_id: null,
                content_request_id: null,
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
                  data: { id: 'job-uuid' },
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
      jsonPost({ model: 'gpt-4o', provider: 'openai' }),
      ctx()
    )
    expect(res.status).toBe(202)
    const j = (await res.json()) as {
      brief_id: string
      generation_job_id: string
      status: string
    }
    expect(j.brief_id).toBe(BRIEF_ID)
    expect(j.generation_job_id).toBe('job-uuid')
    expect(j.status).toBe('pending')
    expect(calls).toBe(2)
  })
})
