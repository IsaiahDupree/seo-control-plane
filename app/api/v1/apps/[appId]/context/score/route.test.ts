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

function thenCount(count: number) {
  const p = Promise.resolve({ count, error: null })
  return { then: p.then.bind(p) as typeof p.then }
}

describe('/api/v1/apps/[appId]/context/score', () => {
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

  it('returns score breakdown from parallel context queries', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_app_features') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    tagline: 't',
                    one_liner: 'o',
                    what_it_does: 'w',
                    differentiators: ['a'],
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_app_personas') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(thenCount(3)),
            }),
          }
        }
        if (table === 'scp_app_ctas') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(thenCount(3)),
              }),
            }),
          }
        }
        if (table === 'scp_app_restrictions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'r' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'scp_app_publishing') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p' }, error: null }),
              }),
            }),
          }
        }
        if (table === 'scp_keywords') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue(thenCount(10)),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${table}`)
      }),
    })

    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.max).toBe(100)
    expect(body.score).toBeGreaterThanOrEqual(90)
    expect(body.generation_blocked).toBe(false)
    expect(body.breakdown.product_summary.score).toBe(20)
    expect(body.breakdown.personas.score).toBe(20)
    expect(body.breakdown.ctas.score).toBe(20)
    expect(body.breakdown.keyword_seeds.score).toBe(10)
  })
})
