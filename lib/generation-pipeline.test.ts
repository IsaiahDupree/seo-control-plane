import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import { buildSelectEqSingleChain, buildUpdateEqEqThenChain } from '@/lib/testing/supabase-mocks'
import type { GenerationResult } from '@/lib/generate'
import { deliverArticle } from '@/lib/deliver'

const mockCreateAdminClient = vi.fn()
const mockAssertMonthly = vi.fn()
const mockGenerateArticle = vi.fn()
const mockSaveGeneratedArticle = vi.fn()
const mockRunQA = vi.fn()
const mockSaveQAReport = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/monthly-limit', () => ({
  assertMonthlyArticleAllowance: (...args: unknown[]) => mockAssertMonthly(...args),
}))

vi.mock('@/lib/generate', () => ({
  generateArticle: (...args: unknown[]) => mockGenerateArticle(...args),
  saveGeneratedArticle: (...args: unknown[]) => mockSaveGeneratedArticle(...args),
}))

vi.mock('@/lib/qa', () => ({
  runQA: (...args: unknown[]) => mockRunQA(...args),
  saveQAReport: (...args: unknown[]) => mockSaveQAReport(...args),
}))

vi.mock('@/lib/deliver', () => ({
  deliverArticle: vi.fn(),
}))

import { runArticleGeneration, type RunGenerationAppRow, type RunGenerationInput } from './generation-pipeline'

function baseApp(overrides: Partial<RunGenerationAppRow> = {}): RunGenerationAppRow {
  return {
    name: 'Test App',
    context: null,
    metadata: null,
    monthly_article_limit: 10_000,
    ...overrides,
  }
}

function baseParams(overrides: Partial<RunGenerationInput> = {}): RunGenerationInput {
  return {
    focus_keyword: 'widget kw',
    secondary_keywords: [],
    content_type: 'guide',
    target_word_count: 800,
    auto_deliver: false,
    brief_id: null,
    content_request_id: null,
    ...overrides,
  }
}

function mockGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return {
    title: 'Widget kw complete guide',
    metaTitle: 'Widget kw guide — tips',
    metaDescription: 'Learn widget kw with this detailed guide covering setup and best practices today.',
    slug: 'widget-kw-guide',
    contentHtml: '<h2>Intro</h2><p>x</p><h2>More</h2><p>y</p>',
    contentMarkdown:
      'Short one.\n\nShort two.\n\nThe widget kw appears here and widget kw again for density.',
    tableOfContents: [],
    tags: [],
    wordCount: 800,
    readingTimeMinutes: 4,
    totalTokens: 1200,
    costUsd: 0.02,
    llmModel: 'gpt-4o-mini',
    llmProvider: 'openai',
    ...overrides,
  }
}

const approvedQA = {
  overallScore: 88,
  outcome: 'approved' as const,
  blockingIssues: [] as string[],
  warnings: [] as string[],
  qualityScore: 88,
  seoScore: 90,
  readabilityScore: 88,
  checksPassed: ['word_count'],
  checksFailed: [] as string[],
}

/** Brief: generating → load row (keyword + request) → complete article → maybeMark all complete → optional keyword + request fulfill */
function installFullBriefFulfillClient() {
  let briefN = 0
  const keywordUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }),
  })
  const requestUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })

  mockCreateAdminClient.mockReturnValue({
    from: vi.fn((t: string) => {
      if (t === 'scp_content_briefs') {
        briefN += 1
        if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
        if (briefN === 2) {
          return buildSelectEqSingleChain({
            data: { keyword_id: 'kw-1', content_request_id: 'req-1' },
            error: null,
          })
        }
        if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
        if (briefN === 4) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ status: 'complete' }],
                error: null,
              }),
            }),
          }
        }
        throw new Error(`unexpected scp_content_briefs call ${briefN}`)
      }
      if (t === 'scp_keywords') {
        return { update: keywordUpdate }
      }
      if (t === 'scp_content_requests') {
        return { update: requestUpdate }
      }
      throw new Error(`unexpected table ${t}`)
    }),
  })

  return { keywordUpdate, requestUpdate }
}

describe('runArticleGeneration', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects with MonthlyArticleLimitExceededError when allowance fails', async () => {
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockAssertMonthly.mockRejectedValue(new MonthlyArticleLimitExceededError(5, 5))

    await expect(runArticleGeneration('app-1', baseApp({ monthly_article_limit: 5 }), baseParams())).rejects.toThrow(
      MonthlyArticleLimitExceededError
    )
    expect(mockGenerateArticle).not.toHaveBeenCalled()
  })

  it('throws when brief generating update fails (no rollback in pipeline)', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: { message: 'row missing' } }),
              }),
            }),
          }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    await expect(
      runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b1' }))
    ).rejects.toThrow('row missing')
    expect(mockGenerateArticle).not.toHaveBeenCalled()
  })

  it('resets brief to pending when generation throws after generating status', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    const briefUpdates: unknown[] = []
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          return {
            update: vi.fn((payload: unknown) => {
              briefUpdates.push(payload)
              return {
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }
            }),
          }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockRejectedValue(new Error('LLM down'))

    await expect(
      runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b1' }))
    ).rejects.toThrow('LLM down')

    expect(briefUpdates[0]).toEqual(expect.objectContaining({ status: 'generating' }))
    expect(briefUpdates[1]).toEqual(expect.objectContaining({ status: 'pending' }))
    expect(mockSaveGeneratedArticle).not.toHaveBeenCalled()
  })

  it('does not reset brief when MonthlyArticleLimitExceededError is thrown', async () => {
    mockAssertMonthly.mockRejectedValue(new MonthlyArticleLimitExceededError(3, 3))
    const from = vi.fn()
    mockCreateAdminClient.mockReturnValue({ from })

    await expect(
      runArticleGeneration('app-1', baseApp({ monthly_article_limit: 3 }), baseParams({ brief_id: 'b1' }))
    ).rejects.toThrow(MonthlyArticleLimitExceededError)

    expect(from).not.toHaveBeenCalled()
  })

  it('returns generation and QA summary without brief or delivery', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    const gen = mockGenerationResult()
    mockGenerateArticle.mockResolvedValue(gen)
    mockSaveGeneratedArticle.mockResolvedValue('art-99')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    const out = await runArticleGeneration('app-1', baseApp(), baseParams())

    expect(out).toEqual({
      article_id: 'art-99',
      slug: gen.slug,
      title: gen.title,
      word_count: gen.wordCount,
      reading_time_minutes: gen.readingTimeMinutes,
      qa: {
        score: 88,
        outcome: 'approved',
        blocking_issues: [],
        warnings: [],
      },
      generation: {
        model: gen.llmModel,
        tokens: gen.totalTokens,
        cost_usd: gen.costUsd,
      },
      delivery: null,
    })
    expect(mockGenerateArticle).toHaveBeenCalledOnce()
    expect(mockSaveGeneratedArticle).toHaveBeenCalledWith(
      'app-1',
      null,
      null,
      gen,
      expect.objectContaining({
        focusKeyword: 'widget kw',
        contentType: 'guide',
      })
    )
    expect(mockRunQA).toHaveBeenCalledWith(
      expect.objectContaining({ articleId: 'art-99', appId: 'app-1', focusKeyword: 'widget kw' })
    )
    expect(mockSaveQAReport).toHaveBeenCalledWith('app-1', 'art-99', approvedQA)
    expect(vi.mocked(deliverArticle)).not.toHaveBeenCalled()
  })

  it('calls deliverArticle when auto_deliver and QA approved', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-d1')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)
    vi.mocked(deliverArticle).mockResolvedValue({ success: true, deliveryId: 'del-1' })

    const out = await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ auto_deliver: true })
    )

    expect(vi.mocked(deliverArticle)).toHaveBeenCalledWith('art-d1', 'app-1')
    expect(out.delivery).toEqual({ success: true, deliveryId: 'del-1' })
  })

  it('skips delivery when QA is not approved', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    mockCreateAdminClient.mockReturnValue({ from: vi.fn() })
    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-x')
    mockRunQA.mockResolvedValue({
      ...approvedQA,
      outcome: 'needs_revision',
      overallScore: 70,
    })
    mockSaveQAReport.mockResolvedValue(undefined)

    const out = await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ auto_deliver: true })
    )

    expect(vi.mocked(deliverArticle)).not.toHaveBeenCalled()
    expect(out.delivery).toBeNull()
  })

  it('completes brief flow, keyword link, and marks content request fulfilled', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    const { keywordUpdate, requestUpdate } = installFullBriefFulfillClient()

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-brief')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ brief_id: 'brief-1', content_request_id: 'req-1' })
    )

    expect(keywordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ article_id: 'art-brief', status: 'assigned' })
    )
    expect(requestUpdate).toHaveBeenCalledWith({ status: 'fulfilled' })
  })

  it('calls deliverArticle after maybeMark when auto_deliver on full brief flow', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    const { keywordUpdate, requestUpdate } = installFullBriefFulfillClient()

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-full-deliver')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)
    vi.mocked(deliverArticle).mockResolvedValue({ success: true, deliveryId: 'del-after-fulfill' })

    const out = await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({
        brief_id: 'brief-full-d',
        content_request_id: 'req-1',
        auto_deliver: true,
      })
    )

    expect(keywordUpdate).toHaveBeenCalled()
    expect(requestUpdate).toHaveBeenCalledWith({ status: 'fulfilled' })
    expect(vi.mocked(deliverArticle)).toHaveBeenCalledWith('art-full-deliver', 'app-1')
    expect(out.delivery).toEqual({ success: true, deliveryId: 'del-after-fulfill' })

    const deliverOrder = vi.mocked(deliverArticle).mock.invocationCallOrder[0]
    const fulfillOrder = requestUpdate.mock.invocationCallOrder[0]
    expect(deliverOrder).toBeGreaterThan(fulfillOrder)
  })

  it('does not mark content request fulfilled when a sibling brief is not complete', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: 'req-2' },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 4) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ status: 'complete' }, { status: 'pending' }],
                  error: null,
                }),
              }),
            }
          }
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        if (t === 'scp_content_requests') {
          return { update: requestUpdate }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-2')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b2' }))

    expect(requestUpdate).not.toHaveBeenCalled()
  })

  it('uses params content_request_id when brief row omits it and still fulfills', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: null },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 4) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ status: 'complete' }],
                  error: null,
                }),
              }),
            }
          }
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        if (t === 'scp_content_requests') {
          return { update: requestUpdate }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-params-req')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ brief_id: 'brief-x', content_request_id: 'req-from-params' })
    )

    expect(mockSaveGeneratedArticle).toHaveBeenCalledWith(
      'app-1',
      'brief-x',
      'req-from-params',
      expect.any(Object),
      expect.any(Object)
    )
    expect(requestUpdate).toHaveBeenCalledWith({ status: 'fulfilled' })
  })

  it('does not fulfill when maybeMark status query errors', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: 'req-e' },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 4) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'rpc failed' },
                }),
              }),
            }
          }
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        if (t === 'scp_content_requests') {
          return { update: requestUpdate }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-err')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b-err' }))

    expect(requestUpdate).not.toHaveBeenCalled()
  })

  it('does not fulfill when maybeMark returns empty brief list', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: 'req-empty' },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 4) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }
          }
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        if (t === 'scp_content_requests') {
          return { update: requestUpdate }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-empty')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b-empty' }))

    expect(requestUpdate).not.toHaveBeenCalled()
  })

  it('skips maybeMark when brief and params both lack content_request_id', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: null },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-no-req')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ brief_id: 'b-no-req', content_request_id: null })
    )

    expect(briefN).toBe(3)
    expect(mockSaveGeneratedArticle).toHaveBeenCalledWith(
      'app-1',
      'b-no-req',
      null,
      expect.any(Object),
      expect.any(Object)
    )
  })

  it('does not fulfill when maybeMark returns null data with no error', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0
    const requestUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: 'req-null-data' },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 4) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }
          }
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        if (t === 'scp_content_requests') {
          return { update: requestUpdate }
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-null-data')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)

    await runArticleGeneration('app-1', baseApp(), baseParams({ brief_id: 'b-null-data' }))

    expect(requestUpdate).not.toHaveBeenCalled()
  })

  it('calls deliverArticle after brief completion when auto_deliver is true', async () => {
    mockAssertMonthly.mockResolvedValue(undefined)
    let briefN = 0

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_content_briefs') {
          briefN += 1
          if (briefN === 1) return buildUpdateEqEqThenChain({ error: null })
          if (briefN === 2) {
            return buildSelectEqSingleChain({
              data: { keyword_id: null, content_request_id: null },
              error: null,
            })
          }
          if (briefN === 3) return buildUpdateEqEqThenChain({ error: null })
          throw new Error(`unexpected scp_content_briefs call ${briefN}`)
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })

    mockGenerateArticle.mockResolvedValue(mockGenerationResult())
    mockSaveGeneratedArticle.mockResolvedValue('art-brief-deliver')
    mockRunQA.mockResolvedValue(approvedQA)
    mockSaveQAReport.mockResolvedValue(undefined)
    vi.mocked(deliverArticle).mockResolvedValue({ success: true, deliveryId: 'del-brief' })

    const out = await runArticleGeneration(
      'app-1',
      baseApp(),
      baseParams({ brief_id: 'brief-del', auto_deliver: true })
    )

    expect(briefN).toBe(3)
    expect(vi.mocked(deliverArticle)).toHaveBeenCalledWith('art-brief-deliver', 'app-1')
    expect(out.delivery).toEqual({ success: true, deliveryId: 'del-brief' })
    expect(out.article_id).toBe('art-brief-deliver')
  })
})
