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

function calendarAdmin() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_publish_queue') {
        return {
          select: vi.fn().mockReturnValue({
            gte: vi.fn().mockReturnValue({
              lte: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'q1',
                        article_id: 'a1',
                        scheduled_for: '2026-06-15T12:00:00Z',
                        status: 'queued',
                        position: 1,
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockResolvedValue({
                        data: [
                          {
                            id: 'a2',
                            slug: 'post',
                            title: 'T',
                            status: 'published',
                            focus_keyword: 'k',
                            published_at: '2026-06-20T10:00:00Z',
                            cluster_name: 'c',
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected ${table}`)
    }),
  }
}

describe('/api/v1/apps/[appId]/content/calendar GET', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when auth fails', async () => {
    mockRequireAppAuth.mockResolvedValue({
      error: jsonError(401, 'unauthorized', 'nope'),
    })
    const res = await GET(new NextRequest('http://localhost/?year=2026&month=6'), ctx())
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid year', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/?year=1999&month=6'), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_year')
  })

  it('returns 400 for invalid month', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const res = await GET(new NextRequest('http://localhost/?year=2026&month=13'), ctx())
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_month')
  })

  it('merges scheduled and published items', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    mockCreateAdminClient.mockReturnValue(calendarAdmin())
    const res = await GET(new NextRequest('http://localhost/?year=2026&month=6'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.view).toBe('month')
    expect(body.scheduled_count).toBe(1)
    expect(body.published_count).toBe(1)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].type).toBe('scheduled')
    expect(body.items[1].type).toBe('published')
  })
})
