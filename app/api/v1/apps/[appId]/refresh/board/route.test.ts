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
const ARTICLE_ID = 'aa0e8400-e29b-41d4-a716-446655440010'

function ctx() {
  return { params: Promise.resolve({ appId: APP_ID }) }
}

describe('/api/v1/apps/[appId]/refresh/board GET', () => {
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

  it('returns empty board when queue empty', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const empty = Promise.resolve({ data: [], error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                then: empty.then.bind(empty),
                catch: empty.catch.bind(empty),
              }),
            }),
          }),
        }),
      })),
    })
    const res = await GET(new NextRequest('http://localhost/'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(body.items).toEqual([])
  })

  it('enriches queue rows with article fields', async () => {
    mockRequireAppAuth.mockResolvedValue({ auth: { appId: APP_ID } })
    const queueRows = [
      {
        id: 'q1',
        article_id: ARTICLE_ID,
        reason: 'decay',
        decay_signals: null,
        priority_score: 90,
        status: 'queued',
        queued_at: '2026-04-01T00:00:00Z',
        completed_at: null,
      },
    ]
    const queuePromise = Promise.resolve({ data: queueRows, error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_refresh_queue') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    then: queuePromise.then.bind(queuePromise),
                    catch: queuePromise.catch.bind(queuePromise),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: ARTICLE_ID,
                    slug: 'my-slug',
                    title: 'My Title',
                    cluster_name: 'Hub',
                    word_count: 1200,
                    published_at: '2026-01-01',
                    gsc_avg_position: 8,
                  },
                ],
                error: null,
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
    expect(body.total).toBe(1)
    expect(body.items[0].slug).toBe('my-slug')
    expect(body.items[0].title).toBe('My Title')
    expect(body.status_counts.queued).toBe(1)
  })
})
