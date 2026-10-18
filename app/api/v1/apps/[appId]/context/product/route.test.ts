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

import { GET, POST } from './route'

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/context/product', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns 401 when auth fails', async () => {
      mockRequireAppAuth.mockResolvedValue({
        error: jsonError(401, 'unauthorized', 'nope'),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(401)
    })

    it('returns 200 with product null when row missing', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        })),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.product).toBeNull()
    })

    it('returns 500 when query fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'db' } }),
            }),
          }),
        })),
      })
      const res = await GET(new NextRequest('http://localhost/'), ctx())
      expect(res.status).toBe(500)
    })
  })

  describe('POST', () => {
    it('returns 400 for invalid JSON', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: 'not-json',
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(400)
    })

    it('returns 400 when validation fails', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tagline: 'x'.repeat(300) }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(400)
    })

    it('upserts product, bumps version, and logs sync', async () => {
      mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
      const insert = vi.fn().mockResolvedValue({ error: null })
      let featuresFrom = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((table: string) => {
          if (table === 'scp_app_sync_logs') {
            return { insert }
          }
          if (table === 'scp_app_features') {
            featuresFrom += 1
            if (featuresFrom === 1) {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
                  }),
                }),
              }
            }
            return {
              upsert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      app_id: APP_ID,
                      version: 2,
                      tagline: 'T',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error(`unexpected ${table}`)
        }),
      })

      const req = new NextRequest('http://localhost/', {
        method: 'POST',
        body: JSON.stringify({ tagline: 'T' }),
        headers: { 'Content-Type': 'application/json' },
      })
      const res = await POST(req, ctx())
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.version).toBe(2)
      expect(body.product.tagline).toBe('T')
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: APP_ID,
          sync_type: 'product',
          version: 2,
        })
      )
    })
  })
})
