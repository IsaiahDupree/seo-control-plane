import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

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

const llmClusters = [
  {
    cluster_name: 'Topic A',
    pillar_keyword: 'alpha',
    keywords: ['alpha', 'beta'],
    intent_type: 'informational',
  },
]

describe('POST /api/v1/apps/[appId]/keywords/cluster', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(jsonPost({ keywords: ['a', 'b'], save: false }), ctx())
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

  it('returns 400 for too_few_keywords when no keywords provided', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost({}), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('too_few_keywords')
  })

  it('returns 400 validation_error when keywords array has one item', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(jsonPost({ keywords: ['only'] }), ctx())
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('validation_error')
  })

  it('returns 502 when LLM throws', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockRejectedValue(new Error('rate limited'))
    const res = await POST(
      jsonPost({ keywords: ['x', 'y'], save: false }),
      ctx()
    )
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('llm_failed')
  })

  it('returns 502 when LLM returns non-JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({ text: 'not json', cost_usd: 0 })
    const res = await POST(
      jsonPost({ keywords: ['x', 'y'], save: false }),
      ctx()
    )
    expect(res.status).toBe(502)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('llm_parse_failed')
  })

  it('clusters keywords and skips DB when save false', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify(llmClusters),
      cost_usd: 0.002,
    })
    const from = vi.fn()
    mockCreateAdminClient.mockReturnValue({ from })
    const res = await POST(
      jsonPost({ keywords: ['alpha', 'beta'], save: false }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      cluster_count: number
      saved: number
      clusters: typeof llmClusters
    }
    expect(j.cluster_count).toBe(1)
    expect(j.saved).toBe(0)
    expect(j.clusters[0].cluster_name).toBe('Topic A')
    expect(from).not.toHaveBeenCalled()
  })

  it('loads active keywords when use_all_active', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCallLLM.mockResolvedValue({
      text: JSON.stringify(llmClusters),
      cost_usd: 0.002,
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({
                data: [{ keyword: 'alpha' }, { keyword: 'beta' }],
                error: null,
              }),
            }),
          }),
        }),
      })),
    })
    const res = await POST(jsonPost({ use_all_active: true, save: false }), ctx())
    expect(res.status).toBe(200)
    expect(mockCallLLM).toHaveBeenCalled()
  })
})
