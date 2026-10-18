import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminClient = vi.fn()
const mockRunArticleGeneration = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/generation-pipeline', () => ({
  runArticleGeneration: (...args: unknown[]) => mockRunArticleGeneration(...args),
}))

import { enqueueStaleArticles, processNextRefreshItem } from './refresh-queue'

function staleArticle(overrides: Record<string, unknown> = {}) {
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString()
  return {
    id: 'art-1',
    slug: 'old-post',
    title: 'Old',
    focus_keyword: 'kw',
    published_at: old,
    updated_at: old,
    qa_score: 50,
    word_count: 400,
    ...overrides,
  }
}

/** Chain: select → eq → in → eq → not → lt → Promise */
function articlesStaleQueryChain(result: { data: unknown; error: unknown }) {
  const terminal = {
    then(onF?: (v: typeof result) => unknown, onR?: (r: unknown) => unknown) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue(terminal),
            }),
          }),
        }),
      }),
    }),
  }
}

function queueSelectExistingChain(result: { data: unknown; error: unknown }) {
  const terminal = {
    then(onF?: (v: typeof result) => unknown, onR?: (r: unknown) => unknown) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue(terminal),
      }),
    }),
  }
}

describe('enqueueStaleArticles', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns zeros when article query errors', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return articlesStaleQueryChain({ data: null, error: { message: 'db' } })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await enqueueStaleArticles('app-1')
    expect(out).toEqual({ enqueued: 0, skipped: 0 })
  })

  it('returns zeros when article data is null', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return articlesStaleQueryChain({ data: null, error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await enqueueStaleArticles('app-1')
    expect(out).toEqual({ enqueued: 0, skipped: 0 })
  })

  it('enqueues one stale article when not already queued', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    let refreshQueueFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return articlesStaleQueryChain({
            data: [staleArticle()],
            error: null,
          })
        }
        if (t === 'scp_refresh_queue') {
          refreshQueueFrom += 1
          if (refreshQueueFrom === 1) {
            return queueSelectExistingChain({ data: [], error: null })
          }
          return { insert }
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await enqueueStaleArticles('app-1')
    expect(out.enqueued).toBe(1)
    expect(out.skipped).toBe(0)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({
      app_id: 'app-1',
      article_id: 'art-1',
      status: 'queued',
    })
  })

  it('skips articles already in queue', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return articlesStaleQueryChain({
            data: [staleArticle()],
            error: null,
          })
        }
        if (t === 'scp_refresh_queue') {
          return queueSelectExistingChain({
            data: [{ article_id: 'art-1' }],
            error: null,
          })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await enqueueStaleArticles('app-1')
    expect(out).toEqual({ enqueued: 0, skipped: 1 })
  })

  it('skips when no decay signals apply', async () => {
    const recent = new Date(Date.now() - 30 * 86_400_000).toISOString()
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return articlesStaleQueryChain({
            data: [
              staleArticle({
                published_at: recent,
                qa_score: 90,
                word_count: 900,
              }),
            ],
            error: null,
          })
        }
        if (t === 'scp_refresh_queue') {
          return queueSelectExistingChain({ data: [], error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await enqueueStaleArticles('app-1', 90)
    expect(out).toEqual({ enqueued: 0, skipped: 1 })
  })
})

describe('processNextRefreshItem', () => {
  afterEach(() => {
    vi.clearAllMocks()
    mockRunArticleGeneration.mockReset()
  })

  it('returns null when no queued item', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      })),
    })
    await expect(processNextRefreshItem('app-1')).resolves.toBeNull()
  })

  it('marks queue skipped when article row missing', async () => {
    const updateChain = () => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    })
    let queueFrom = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_refresh_queue') {
          queueFrom += 1
          if (queueFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    order: vi.fn().mockReturnValue({
                      limit: vi.fn().mockReturnValue({
                        single: vi.fn().mockResolvedValue({
                          data: { id: 'q1', article_id: 'missing' },
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }
          }
          return updateChain()
        }
        if (t === 'scp_articles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await processNextRefreshItem('app-1')
    expect(out).toEqual({
      article_id: 'missing',
      slug: '',
      success: false,
      error: 'Article not found',
    })
    expect(queueFrom).toBe(3)
  })

  it('runs generation and marks delivered on success', async () => {
    mockRunArticleGeneration.mockResolvedValue(undefined)
    let fromCall = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCall += 1
        if (fromCall === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'q1', article_id: 'a1' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (fromCall === 2 || fromCall === 5) {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (fromCall === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'a1',
                    slug: 'my-slug',
                    focus_keyword: 'kw',
                    secondary_keywords: [],
                    content_type: 'cluster',
                    cluster_name: null,
                    word_count: 800,
                    target_word_count: 1200,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (fromCall === 4) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    name: 'App',
                    context: {},
                    metadata: {},
                    monthly_article_limit: 40,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected from() call ${fromCall}`)
      }),
    })
    const out = await processNextRefreshItem('app-1')
    expect(out).toEqual({
      article_id: 'a1',
      slug: 'my-slug',
      success: true,
    })
    expect(mockRunArticleGeneration).toHaveBeenCalledTimes(1)
    expect(fromCall).toBe(5)
  })

  it('returns failure and skips queue when app row is missing', async () => {
    let fromCall = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCall += 1
        if (fromCall === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'q1', article_id: 'a1' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (fromCall === 2 || fromCall === 5) {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (fromCall === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'a1',
                    slug: 's',
                    focus_keyword: 'k',
                    secondary_keywords: [],
                    content_type: 'cluster',
                    cluster_name: null,
                    word_count: 100,
                    target_word_count: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (fromCall === 4) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }
        }
        throw new Error(`unexpected from() call ${fromCall}`)
      }),
    })
    const out = await processNextRefreshItem('app-1')
    expect(out).toEqual({
      article_id: 'a1',
      slug: 's',
      success: false,
      error: 'App not found',
    })
    expect(mockRunArticleGeneration).not.toHaveBeenCalled()
    expect(fromCall).toBe(5)
  })

  it('returns failure when generation throws and marks queue skipped', async () => {
    mockRunArticleGeneration.mockRejectedValue(new Error('LLM timeout'))
    let fromCall = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => {
        fromCall += 1
        if (fromCall === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'q1', article_id: 'a1' },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (fromCall === 2 || fromCall === 5) {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }
        if (fromCall === 3) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'a1',
                    slug: 'slug-x',
                    focus_keyword: 'k',
                    secondary_keywords: [],
                    content_type: 'cluster',
                    cluster_name: null,
                    word_count: 100,
                    target_word_count: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (fromCall === 4) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    name: 'App',
                    context: {},
                    metadata: {},
                    monthly_article_limit: 10,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected from() call ${fromCall}`)
      }),
    })
    const out = await processNextRefreshItem('app-1')
    expect(out).toEqual({
      article_id: 'a1',
      slug: 'slug-x',
      success: false,
      error: 'LLM timeout',
    })
    expect(mockRunArticleGeneration).toHaveBeenCalledTimes(1)
    expect(fromCall).toBe(5)
  })
})
