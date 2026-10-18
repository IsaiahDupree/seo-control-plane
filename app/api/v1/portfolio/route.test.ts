import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

const APP_ID = '550e8400-e29b-41d4-a716-446655440000'
const SECRET = 'portfolio-test-secret'

function thenableResult<T>(data: T, error: { message: string } | null = null) {
  const p = Promise.resolve({ data, error })
  return { then: p.then.bind(p), catch: p.catch.bind(p) }
}

function portfolioAdmin() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_apps') {
        return {
          select: vi.fn().mockReturnValue(
            thenableResult([
              {
                id: APP_ID,
                slug: 'my-app',
                name: 'My App',
                domain: 'example.com',
                status: 'active',
                plan: 'pro',
                monthly_article_limit: 50,
                monthly_articles_generated: 2,
              },
            ])
          ),
        }
      }
      if (table === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue(
              thenableResult([
                {
                  app_id: APP_ID,
                  status: 'published',
                  published_at: '2026-01-01',
                  gsc_clicks: 10,
                  gsc_avg_position: 5,
                },
                {
                  app_id: APP_ID,
                  status: 'draft',
                  published_at: null,
                  gsc_clicks: 0,
                  gsc_avg_position: null,
                },
              ])
            ),
          }),
        }
      }
      if (table === 'scp_keywords') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue(
              thenableResult([
                { app_id: APP_ID, status: 'active', cluster_name: 'c1' },
                { app_id: APP_ID, status: 'active', cluster_name: 'c1' },
              ])
            ),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
}

describe('GET /api/v1/portfolio', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function loadGet() {
    const { GET } = await import('./route')
    return GET
  }

  it('returns 401 when bearer does not match portfolio secret', async () => {
    vi.stubEnv('SCP_PORTFOLIO_SECRET', SECRET)
    vi.stubEnv('CRON_SECRET', '')
    const GET = await loadGet()
    const res = await GET(
      new NextRequest('http://localhost/', {
        headers: { Authorization: 'Bearer wrong' },
      })
    )
    expect(res.status).toBe(401)
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('returns 200 with totals and per-app stats', async () => {
    vi.stubEnv('SCP_PORTFOLIO_SECRET', SECRET)
    mockCreateAdminClient.mockReturnValue(portfolioAdmin())
    const GET = await loadGet()
    const res = await GET(
      new NextRequest('http://localhost/', {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      totals: {
        total_apps: number
        total_published_articles: number
        total_gsc_clicks: number
      }
      apps: Array<{
        app_id: string
        stats: { published_articles: number; draft_articles: number }
      }>
      generated_at: string
    }
    expect(j.totals.total_apps).toBe(1)
    expect(j.totals.total_published_articles).toBe(1)
    expect(j.totals.total_gsc_clicks).toBe(10)
    expect(j.apps[0].app_id).toBe(APP_ID)
    expect(j.apps[0].stats.published_articles).toBe(1)
    expect(j.apps[0].stats.draft_articles).toBe(1)
    expect(j.generated_at).toBeDefined()
  })

  it('returns 500 when apps query fails', async () => {
    vi.stubEnv('SCP_PORTFOLIO_SECRET', SECRET)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'scp_apps') {
          return {
            select: vi.fn().mockReturnValue(thenableResult(null, { message: 'db down' })),
          }
        }
        if (table === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(thenableResult([])),
            }),
          }
        }
        if (table === 'scp_keywords') {
          return {
            select: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue(thenableResult([])),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      }),
    })
    const GET = await loadGet()
    const res = await GET(
      new NextRequest('http://localhost/', {
        headers: { Authorization: `Bearer ${SECRET}` },
      })
    )
    expect(res.status).toBe(500)
    const j = (await res.json()) as { error: { code: string } }
    expect(j.error.code).toBe('query_failed')
  })
})
