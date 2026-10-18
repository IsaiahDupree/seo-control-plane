import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAll = vi.fn(() => [] as { name: string; value: string }[])
const mockSet = vi.fn()
const mockSignOut = vi.fn()
const mockCreateServerClient = vi.fn()

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: mockGetAll,
    set: mockSet,
  })),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}))

import { POST } from './route'

describe('POST /logout', () => {
  beforeEach(() => {
    mockSignOut.mockResolvedValue(undefined)
    mockCreateServerClient.mockReturnValue({
      auth: { signOut: mockSignOut },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls signOut and redirects to /login', async () => {
    const req = new NextRequest('https://example.com/logout', { method: 'POST' })
    const res = await POST(req)
    expect(mockCreateServerClient).toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.status).toBeLessThan(400)
    const loc = res.headers.get('location')
    expect(loc).toBeTruthy()
    expect(new URL(loc!).pathname).toBe('/login')
  })
})
