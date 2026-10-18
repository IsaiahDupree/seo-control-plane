import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildSelectEqEqSingleChain,
  buildUpdateEqThenChain,
} from '@/lib/testing/supabase-mocks'

const mockCreateAdminClient = vi.fn()
const mockApplyInternalLinks = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/internal-links', () => ({
  applyInternalLinks: (...args: unknown[]) => mockApplyInternalLinks(...args),
}))

import { deliverArticle } from './deliver'

function fullArticle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    slug: 'post-slug',
    title: 'Title',
    delivery_version: 1,
    content_html: '<p>body</p>',
    body_mdx: '# md',
    content_markdown: '',
    meta_title: 'MT',
    meta_description: 'MD',
    description: '',
    og_image_url: null,
    canonical_url: 'https://c.example/p',
    focus_keyword: 'kw',
    secondary_keywords: ['a'],
    content_type: 'article',
    cluster_name: null,
    word_count: 100,
    reading_time_minutes: 2,
    author: { name: 'x' },
    schema_json: {},
    table_of_contents: [],
    cta_blocks: [],
    internal_links: [],
    tags: [],
    is_stub: false,
    is_visible: true,
    published_at: '2026-01-01T00:00:00Z',
    qa_score: 80,
    confidence_score: 0.9,
    ...overrides,
  }
}

describe('deliverArticle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mockApplyInternalLinks.mockReset()
  })

  it('returns error when article is missing', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({ data: null, error: null })
        }
        if (t === 'scp_apps') {
          return buildSelectEqEqSingleChain({
            data: { id: 'app-1', webhook_url: 'https://hook', webhook_secret: 's', slug: 'app' },
            error: null,
          })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await deliverArticle('missing', 'app-1')
    expect(out.success).toBe(false)
    expect(out.error).toBe('Article not found')
    expect(out.deliveryId).toBe('')
  })

  it('returns error when app is missing', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({
            data: { id: 'a1', slug: 'x', delivery_version: 0, content_html: '' },
            error: null,
          })
        }
        if (t === 'scp_apps') {
          return buildSelectEqEqSingleChain({ data: null, error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await deliverArticle('a1', 'app-1')
    expect(out.success).toBe(false)
    expect(out.error).toBe('App not found')
  })

  it('returns error when webhook_url is not configured', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({
            data: {
              id: 'a1',
              slug: 'x',
              title: 'T',
              delivery_version: 0,
              content_html: '<p>hi</p>',
              body_mdx: '',
              content_markdown: '',
              meta_title: '',
              meta_description: '',
              description: '',
              og_image_url: null,
              canonical_url: '',
              focus_keyword: '',
              secondary_keywords: [],
              content_type: 'article',
              cluster_name: null,
              word_count: 0,
              reading_time_minutes: 1,
              author: {},
              schema_json: {},
              table_of_contents: [],
              cta_blocks: [],
              internal_links: [],
              tags: [],
              is_stub: false,
              is_visible: true,
              published_at: null,
              qa_score: null,
              confidence_score: null,
            },
            error: null,
          })
        }
        if (t === 'scp_apps') {
          return buildSelectEqEqSingleChain({
            data: {
              id: 'app-1',
              webhook_url: null,
              webhook_secret: 'secret',
              slug: 'app',
            },
            error: null,
          })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await deliverArticle('a1', 'app-1')
    expect(out.success).toBe(false)
    expect(out.error).toBe('App has no webhook_url configured')
  })

  it('returns error when delivery insert fails', async () => {
    mockApplyInternalLinks.mockResolvedValue({ html: '<p>x</p>', links: [] })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_articles') {
          return buildSelectEqEqSingleChain({
            data: fullArticle(),
            error: null,
          })
        }
        if (t === 'scp_apps') {
          return buildSelectEqEqSingleChain({
            data: {
              id: 'app-1',
              webhook_url: 'https://hook.example/h',
              webhook_secret: 'whsec',
              slug: 'app',
            },
            error: null,
          })
        }
        if (t === 'scp_deliveries') {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'duplicate key' },
                }),
              }),
            }),
          }
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const out = await deliverArticle('a1', 'app-1')
    expect(out.success).toBe(false)
    expect(out.deliveryId).toBe('')
    expect(out.error).toBe('duplicate key')
    expect(mockApplyInternalLinks).not.toHaveBeenCalled()
  })

  it('posts webhook, marks delivered, and updates article on HTTP 200', async () => {
    mockApplyInternalLinks.mockResolvedValue({ html: '<p>enriched</p>', links: [] })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    let step = 0
    const publishInsert = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        step += 1
        if (step === 1) {
          expect(t).toBe('scp_articles')
          return buildSelectEqEqSingleChain({ data: fullArticle(), error: null })
        }
        if (step === 2) {
          expect(t).toBe('scp_apps')
          return buildSelectEqEqSingleChain({
            data: {
              id: 'app-1',
              webhook_url: 'https://hook.example/webhook',
              webhook_secret: 'whsec',
              slug: 'app',
            },
            error: null,
          })
        }
        if (step === 3) {
          expect(t).toBe('scp_deliveries')
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'del-99' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (step === 4) {
          expect(t).toBe('scp_deliveries')
          return buildUpdateEqThenChain({ error: null })
        }
        if (step === 5) {
          expect(t).toBe('scp_deliveries')
          return buildUpdateEqThenChain({ error: null })
        }
        if (step === 6) {
          expect(t).toBe('scp_articles')
          return buildUpdateEqThenChain({ error: null })
        }
        if (step === 7) {
          expect(t).toBe('scp_publish_logs')
          return { insert: publishInsert }
        }
        throw new Error(`unexpected step ${step} table ${t}`)
      }),
    })

    const out = await deliverArticle('a1', 'app-1')
    expect(out).toEqual({ success: true, deliveryId: 'del-99' })
    expect(mockApplyInternalLinks).toHaveBeenCalledWith(
      'app-1',
      'a1',
      '<p>body</p>',
      expect.any(String)
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hook.example/webhook')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['X-SCP-Delivery-ID']).toBe('del-99')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse((init?.body as string) ?? '{}') as { content_html: string; version: number }
    expect(body.content_html).toBe('<p>enriched</p>')
    expect(body.version).toBe(2)
    expect(publishInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: 'app-1',
        article_id: 'a1',
        delivery_id: 'del-99',
        event_type: 'delivered',
      })
    )
  })

  it('marks delivery failed after three non-OK webhook responses', async () => {
    mockApplyInternalLinks.mockResolvedValue({ html: '<p>x</p>', links: [] })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'upstream',
    })
    vi.stubGlobal('fetch', fetchMock)

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(
      ((fn: TimerHandler) => {
        if (typeof fn === 'function') queueMicrotask(fn)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout
    )

    let step = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        step += 1
        if (step === 1) {
          expect(t).toBe('scp_articles')
          return buildSelectEqEqSingleChain({ data: fullArticle(), error: null })
        }
        if (step === 2) {
          expect(t).toBe('scp_apps')
          return buildSelectEqEqSingleChain({
            data: {
              id: 'app-1',
              webhook_url: 'https://hook.example/w',
              webhook_secret: 'sec',
              slug: 'app',
            },
            error: null,
          })
        }
        if (step === 3) {
          expect(t).toBe('scp_deliveries')
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'del-fail' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (step >= 4 && step <= 7) {
          expect(t).toBe('scp_deliveries')
          return buildUpdateEqThenChain({ error: null })
        }
        throw new Error(`unexpected step ${step} table ${t}`)
      }),
    })

    try {
      const out = await deliverArticle('a1', 'app-1')
      expect(out.success).toBe(false)
      expect(out.deliveryId).toBe('del-fail')
      expect(out.error).toContain('HTTP 502')
      expect(out.error).toContain('upstream')
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(step).toBe(7)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  it('marks delivery failed when fetch throws on every attempt', async () => {
    mockApplyInternalLinks.mockResolvedValue({ html: '<p>x</p>', links: [] })
    const fetchMock = vi.fn().mockRejectedValue(new Error('econnrefused'))
    vi.stubGlobal('fetch', fetchMock)

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(
      ((fn: TimerHandler) => {
        if (typeof fn === 'function') queueMicrotask(fn)
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout
    )

    let step = 0
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        step += 1
        if (step === 1) {
          return buildSelectEqEqSingleChain({ data: fullArticle(), error: null })
        }
        if (step === 2) {
          return buildSelectEqEqSingleChain({
            data: {
              id: 'app-1',
              webhook_url: 'https://hook.example/w',
              webhook_secret: 'sec',
              slug: 'app',
            },
            error: null,
          })
        }
        if (step === 3) {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'del-net' },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (step >= 4 && step <= 7) {
          expect(t).toBe('scp_deliveries')
          return buildUpdateEqThenChain({ error: null })
        }
        throw new Error(`unexpected step ${step} table ${t}`)
      }),
    })

    try {
      const out = await deliverArticle('a1', 'app-1')
      expect(out.success).toBe(false)
      expect(out.deliveryId).toBe('del-net')
      expect(out.error).toContain('econnrefused')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })
})
