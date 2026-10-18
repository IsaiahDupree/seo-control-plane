import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildUpdateEqEqThenChain } from '@/lib/testing/supabase-mocks'

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

describe('POST /api/v1/apps/[appId]/keywords/volume-enrich', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: [{ keyword: 'x', search_volume: 1 }] }),
      }),
      ctx()
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid JSON', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      ctx()
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_json')
  })

  it('updates entries and reports first errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const okUpdate = buildUpdateEqEqThenChain({ error: null })
    const errUpdate = buildUpdateEqEqThenChain({ error: { message: 'rls' } })
    let calls = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        calls += 1
        return calls === 1 ? okUpdate : errUpdate
      }),
    })
    const res = await POST(
      new NextRequest('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: [
            { keyword: 'Alpha', search_volume: 100, difficulty: 10 },
            { keyword: 'Beta', search_volume: 200, difficulty: 20 },
          ],
        }),
      }),
      ctx()
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { updated: number; total: number; errors?: string[] }
    expect(j.total).toBe(2)
    expect(j.updated).toBe(1)
    expect(j.errors?.[0]).toContain('Beta:')
  })
})

