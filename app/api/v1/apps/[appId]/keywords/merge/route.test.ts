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
const CANON_ID = '660e8400-e29b-41d4-a716-446655440001'

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

describe('POST /api/v1/apps/[appId]/keywords/merge', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      jsonPost({ canonical_keyword: 'a', duplicate_keywords: ['b'] }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when no duplicates after normalisation', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      jsonPost({ canonical_keyword: 'Same', duplicate_keywords: [' same '] }),
      ctx()
    )
    expect(res.status).toBe(400)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('no_duplicates')
  })

  it('returns 404 when canonical keyword missing', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqEqMaybeSingleChain({ data: null, error: null })
      ),
    })
    const res = await POST(
      jsonPost({ canonical_keyword: 'missing', duplicate_keywords: ['x'] }),
      ctx()
    )
    expect(res.status).toBe(404)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('canonical_not_found')
  })

  it('merges duplicates and archives them', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        if (calls === 1) {
          return buildSelectEqEqMaybeSingleChain({
            data: {
              id: CANON_ID,
              keyword: 'main',
              search_volume: 10,
              difficulty: 50,
              opportunity_score: 5,
              cluster_name: null,
            },
            error: null,
          })
        }
        if (calls === 2) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: 'dup-1',
                      keyword: 'dup',
                      search_volume: 100,
                      difficulty: 20,
                      opportunity_score: 9,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (calls === 3) {
          return buildUpdateEqThenChain({ error: null })
        }
        if (calls === 4) {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected from call ${calls}`)
      }),
    })
    const res = await POST(
      jsonPost({ canonical_keyword: 'main', duplicate_keywords: ['dup'] }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      merged_count: number
      canonical_id: string
      merged_metadata: { search_volume: number | null }
    }
    expect(j.merged_count).toBe(1)
    expect(j.canonical_id).toBe(CANON_ID)
    expect(j.merged_metadata.search_volume).toBe(100)
  })
})
