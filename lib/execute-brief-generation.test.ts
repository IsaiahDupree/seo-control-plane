import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSelectEqEqSingleChain, buildSelectEqSingleChain } from '@/lib/testing/supabase-mocks'

const mockCreateAdminClient = vi.fn()
const mockRunArticleGeneration = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/generation-pipeline', () => ({
  runArticleGeneration: (...args: unknown[]) => mockRunArticleGeneration(...args),
}))

import {
  AppNotFoundError,
  BriefNotFoundError,
  BriefNotPendingError,
  executeBriefGeneration,
} from './execute-brief-generation'

const appRow = {
  id: 'app-1',
  name: 'My App',
  context: { brand_voice: 'friendly' },
  metadata: { description: 'meta' },
  monthly_article_limit: 50,
}

const briefRow = {
  id: 'brief-1',
  status: 'pending' as const,
  focus_keyword: 'widget kw',
  secondary_keywords: ['a', 'b'],
  content_type: 'guide',
  cluster_name: 'main',
  target_word_count: 900,
  target_persona: 'builders',
  tone_notes: 'clear',
  cta_guidance: 'signup',
  content_request_id: 'req-9',
}

const genResult = {
  article_id: 'art-1',
  slug: 'slug',
  title: 'T',
  word_count: 100,
  reading_time_minutes: 1,
  qa: { score: 80, outcome: 'approved', blocking_issues: [], warnings: [] },
  generation: { model: 'gpt-4o-mini', tokens: 1, cost_usd: 0 },
  delivery: null,
}

describe('executeBriefGeneration', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  function installDbMocks(brief: typeof briefRow | null, app: typeof appRow | null = appRow) {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_apps') {
          return buildSelectEqSingleChain({
            data: app,
            error: app ? null : { message: 'missing' },
          })
        }
        if (t === 'scp_content_briefs') {
          return buildSelectEqEqSingleChain({
            data: brief,
            error: brief ? null : { message: 'missing' },
          })
        }
        throw new Error(`unexpected table ${t}`)
      }),
    })
  }

  it('throws AppNotFoundError when app row is missing', async () => {
    installDbMocks(briefRow, null)
    await expect(executeBriefGeneration('app-1', 'brief-1')).rejects.toThrow(AppNotFoundError)
    expect(mockRunArticleGeneration).not.toHaveBeenCalled()
  })

  it('throws BriefNotFoundError when brief row is missing', async () => {
    installDbMocks(null)
    await expect(executeBriefGeneration('app-1', 'brief-1')).rejects.toThrow(BriefNotFoundError)
    expect(mockRunArticleGeneration).not.toHaveBeenCalled()
  })

  it('throws BriefNotPendingError when brief is not pending', async () => {
    installDbMocks({ ...briefRow, status: 'generating' })
    await expect(executeBriefGeneration('app-1', 'brief-1')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof BriefNotPendingError &&
        (err as BriefNotPendingError).status === 'generating'
    )
    expect(mockRunArticleGeneration).not.toHaveBeenCalled()
  })

  it('calls runArticleGeneration with merged brief, app, and overrides', async () => {
    installDbMocks(briefRow)
    mockRunArticleGeneration.mockResolvedValue(genResult)

    const out = await executeBriefGeneration('app-1', 'brief-1', {
      content_type: 'faq',
      target_word_count: 500,
      auto_deliver: true,
    })

    expect(out).toEqual(genResult)
    expect(mockRunArticleGeneration).toHaveBeenCalledWith(
      'app-1',
      {
        name: 'My App',
        context: { brand_voice: 'friendly' },
        metadata: { description: 'meta' },
        monthly_article_limit: 50,
      },
      expect.objectContaining({
        focus_keyword: 'widget kw',
        secondary_keywords: ['a', 'b'],
        content_type: 'faq',
        cluster_name: 'main',
        target_word_count: 500,
        target_persona: 'builders',
        tone_notes: 'clear',
        cta_guidance: 'signup',
        auto_deliver: true,
        brief_id: 'brief-1',
        content_request_id: 'req-9',
      })
    )
  })

  it('defaults monthly_article_limit to 30 when app column is null', async () => {
    installDbMocks(briefRow, { ...appRow, monthly_article_limit: null as unknown as number })
    mockRunArticleGeneration.mockResolvedValue(genResult)

    await executeBriefGeneration('app-1', 'brief-1')

    expect(mockRunArticleGeneration).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ monthly_article_limit: 30 }),
      expect.any(Object)
    )
  })
})
