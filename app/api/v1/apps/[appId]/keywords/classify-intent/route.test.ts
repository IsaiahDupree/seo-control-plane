import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildUpdateEqEqThenChain } from '@/lib/testing/supabase-mocks'

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

function jsonPost(body: unknown) {
  return new NextRequest('http://localhost/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/apps/[appId]/keywords/classify-intent', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ keywords: ['a'] }), ctx())
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
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('invalid_json')
  })

  it('returns 502 when LLM throws', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockRejectedValue(new Error('rate limited'))
    const res = await POST(jsonPost({ keywords: ['a', 'b'], save: false }), ctx())
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('llm_failed')
  })

  it('returns 502 when LLM returns non-JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({ text: 'not json', cost_usd: 0 })
    const res = await POST(jsonPost({ keywords: ['a', 'b'], save: false }), ctx())
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('llm_parse_failed')
  })

  it('filters invalid intents and does not save when save=false', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify([
        {
          keyword: 'Alpha',
          intent_type: 'informational',
          confidence: 0.9,
          reasoning: 'learn',
        },
        {
          keyword: 'Beta',
          intent_type: 'wrong_intent',
          confidence: 0.2,
          reasoning: 'bad',
        },
      ]),
      cost_usd: 0.001,
    })
    const from = vi.fn()
    mockCreateAdminClient.mockReturnValue({ from })
    const res = await POST(jsonPost({ keywords: ['Alpha', 'Beta'], save: false }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { classified: number; saved: number; results: Array<{ keyword: string }> }
    expect(j.classified).toBe(1)
    expect(j.saved).toBe(0)
    expect(j.results).toHaveLength(1)
    expect(j.results[0].keyword).toBe('Alpha')
    expect(from).not.toHaveBeenCalled()
  })

  it('saves validated results when save=true', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify([
        {
          keyword: 'Alpha',
          intent_type: 'transactional',
          confidence: 0.8,
          reasoning: 'buy',
        },
      ]),
      cost_usd: 0.001,
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildUpdateEqEqThenChain({ error: null })),
    })
    const res = await POST(jsonPost({ keywords: ['Alpha'], save: true }), ctx())
    expect(res.status).toBe(200)
    const j = (await res.json()) as { classified: number; saved: number }
    expect(j.classified).toBe(1)
    expect(j.saved).toBe(1)
  })
})

