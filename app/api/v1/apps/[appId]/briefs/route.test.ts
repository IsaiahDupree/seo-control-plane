import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonError } from '@/lib/api-errors'
import { buildSelectEqOrderRangeChain } from '@/lib/testing/supabase-mocks'

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

describe('GET /api/v1/apps/[appId]/briefs', () => {
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

  it('returns 500 when query errors', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        buildSelectEqOrderRangeChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(500)
  })

  it('defaults to status pending', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/'), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending')
  })

  it('does not force pending when all_statuses=1', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/?all_statuses=1'), ctx())
    expect(chain.eq).toHaveBeenCalledWith('app_id', APP_ID)
    expect(chain.eq).not.toHaveBeenCalledWith('status', 'pending')
  })

  it('uses explicit status filter', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const chain = buildSelectEqOrderRangeChain({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({ from: vi.fn(() => chain) })
    await GET(new NextRequest('http://localhost/?status=complete'), ctx())
    expect(chain.eq).toHaveBeenCalledWith('status', 'complete')
  })

  it('caps limit at 200', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => buildSelectEqOrderRangeChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/?limit=999'), ctx())
    expect((await res.json()).limit).toBe(200)
  })
})
