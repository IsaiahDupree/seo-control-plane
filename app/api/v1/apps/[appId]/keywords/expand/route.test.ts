import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqEqMaybeSingleChain } from '@/lib/testing/supabase-mocks'

const mockCallLLM = vi.fn()

vi.mock('@/lib/llm', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}))

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

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('POST /api/v1/apps/[appId]/keywords/expand', () => {
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

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        body: '{',
        headers: { 'Content-Type': 'application/json' },
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_json')
  })

  it('returns 502 when LLM throws', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockRejectedValue(new Error('boom'))
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillar_keyword: 'widgets', count: 5 }),
      }),
      ctx()
    )
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('llm_failed')
  })

  it('returns 502 when LLM returns non-JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({ text: 'not json', cost_usd: 0 })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillar_keyword: 'widgets', count: 5 }),
      }),
      ctx()
    )
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('llm_parse_failed')
  })

  it('returns 502 when LLM generates no valid keywords', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({ text: JSON.stringify([]), cost_usd: 0 })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillar_keyword: 'widgets', count: 5 }),
      }),
      ctx()
    )
    expect(res.status).toBe(502)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no_keywords')
  })

  it('upserts keywords and returns saved rows', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify([
        {
          keyword: 'widgets for teams',
          intent_type: 'informational',
          estimated_difficulty: 12,
          pattern: 'persona_fit',
        },
      ]),
      cost_usd: 0.01,
    })
    const upsert = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'k1',
            keyword: 'widgets for teams',
            intent_type: 'informational',
            difficulty: 12,
            cluster_name: 'widgets',
          },
        ],
        error: null,
      }),
    })
    let fromCalls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_app_features') {
          fromCalls += 1
          return buildSelectEqEqMaybeSingleChain({ data: null, error: null })
        }
        if (table === 'scp_keywords') {
          return { upsert }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pillar_keyword: 'widgets', count: 5 }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { saved: number; keywords: Array<{ id: string }> }
    expect(j.saved).toBe(1)
    expect(j.keywords).toHaveLength(1)
    expect(fromCalls).toBe(1)
  })
})

