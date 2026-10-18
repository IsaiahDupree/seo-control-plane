import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUpdateEqThenChain } from '@/lib/testing/supabase-mocks'

const mockCronBearerOk = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/cron-auth', () => ({
  cronBearerOk: (...args: unknown[]) => mockCronBearerOk(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { GET } from './route'

function publishQueueDueChain(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        lte: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}

describe('GET /api/cron/auto-publish', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when cron bearer check fails', async () => {
    mockCronBearerOk.mockReturnValue(false)
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 500 when publish queue query fails', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        publishQueueDueChain({ data: null, error: { message: 'db' } })
      ),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })

  it('returns zeros when no due queue items', async () => {
    mockCronBearerOk.mockReturnValue(true)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => publishQueueDueChain({ data: [], error: null })),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      processed: number
      published: number
      skipped: number
    }
    expect(j.processed).toBe(0)
    expect(j.published).toBe(0)
    expect(j.skipped).toBe(0)
  })

  it('publishes when app has no publish_window and updates succeed', async () => {
    mockCronBearerOk.mockReturnValue(true)
    const itemId = 'q1'
    const articleId = 'a1'
    const appId = '550e8400-e29b-41d4-a716-446655440000'
    const insertLog = vi.fn().mockResolvedValue({ error: null })
    let pqSelect = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_publish_queue') {
          pqSelect += 1
          if (pqSelect === 1) {
            return publishQueueDueChain({
              data: [
                {
                  id: itemId,
                  article_id: articleId,
                  app_id: appId,
                  scheduled_for: new Date().toISOString(),
                },
              ],
              error: null,
            })
          }
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { context: {}, status: 'active' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'scp_articles') {
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_publish_logs') {
          return { insert: insertLog }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      published: number
      published_article_ids: string[]
    }
    expect(j.published).toBe(1)
    expect(j.published_article_ids).toEqual([articleId])
    expect(insertLog).toHaveBeenCalled()
  })

  it('skips when app inactive', async () => {
    mockCronBearerOk.mockReturnValue(true)
    const itemId = 'q1'
    const articleId = 'a1'
    const appId = '550e8400-e29b-41d4-a716-446655440000'
    let pqSelect = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_publish_queue') {
          pqSelect += 1
          if (pqSelect === 1) {
            return publishQueueDueChain({
              data: [
                {
                  id: itemId,
                  article_id: articleId,
                  app_id: appId,
                  scheduled_for: new Date().toISOString(),
                },
              ],
              error: null,
            })
          }
          return buildUpdateEqThenChain({ error: null })
        }
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { context: {}, status: 'paused' },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    })
    const res = await GET(new NextRequest('http://localhost/'))
    expect(res.status).toBe(200)
    const j = (await res.json()) as { skipped: number; published: number }
    expect(j.skipped).toBe(1)
    expect(j.published).toBe(0)
  })
})
