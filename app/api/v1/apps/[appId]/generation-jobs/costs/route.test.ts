import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'

const mockRequireAppAuth = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/require-app-auth', () => ({
  requireAppAuth: (...args: unknown[]) => mockRequireAppAuth(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/generation-jobs/costs GET', () => {
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

  it('aggregates costs by model', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'j1',
                        status: 'complete',
                        llm_provider: 'openai',
                        llm_model: 'gpt-4',
                        total_tokens: 1000,
                        cost_usd: 0.05,
                        created_at: '2026-04-01T12:00:00Z',
                        completed_at: '2026-04-01T12:01:00Z',
                      },
                      {
                        id: 'j2',
                        status: 'complete',
                        llm_provider: 'openai',
                        llm_model: 'gpt-4',
                        total_tokens: 500,
                        cost_usd: 0.02,
                        created_at: '2026-04-02T12:00:00Z',
                        completed_at: '2026-04-02T12:01:00Z',
                      },
                      {
                        id: 'j3',
                        status: 'failed',
                        llm_provider: 'openai',
                        llm_model: 'gpt-4',
                        total_tokens: 0,
                        cost_usd: 0,
                        created_at: '2026-04-03T12:00:00Z',
                        completed_at: null,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/?since=2026-04-01&until=2026-04-30'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.total_jobs).toBe(3)
    expect(body.summary.completed_jobs).toBe(2)
    expect(body.summary.failed_jobs).toBe(1)
    expect(body.summary.total_cost_usd).toBeCloseTo(0.07, 5)
    expect(body.by_model).toHaveLength(1)
    expect(body.by_model[0].job_count).toBe(2)
  })
})
