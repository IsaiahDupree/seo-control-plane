import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildUpdateEqThenChain } from '@/lib/testing/supabase-mocks'

const mockCallLLM = vi.fn()
const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/llm', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}))

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import { runQA, saveQAReport, type QAInput, type QAResult } from './qa'

function goodInput(overrides: Partial<QAInput> = {}): QAInput {
  return {
    articleId: 'a1',
    appId: 'app-1',
    title: 'Guide to widget kw for beginners',
    contentHtml: '<h2>Intro</h2><p>x</p><h2>More</h2><p>y</p>',
    contentMarkdown:
      'Short para one.\n\nShort para two.\n\nThe widget kw appears here and widget kw again.',
    metaTitle: 'Widget kw guide — complete tips',
    metaDescription:
      'Learn widget kw with this detailed guide covering setup, tips, and best practices today.',
    focusKeyword: 'widget kw',
    wordCount: 800,
    contentType: 'article',
    ...overrides,
  }
}

describe('runQA', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns rejected when blocking word_count fails', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 95, "issues": []}' })
    const out = await runQA(goodInput({ wordCount: 100 }))
    expect(out.outcome).toBe('rejected')
    expect(out.blockingIssues.some((m) => m.includes('Word count'))).toBe(true)
    expect(out.checksFailed).toContain('word_count')
  })

  it('returns approved when checks and LLM score are strong', async () => {
    mockCallLLM.mockResolvedValue({
      text: '{"score": 92, "issues": []}',
    })
    const out = await runQA(goodInput())
    expect(out.outcome).toBe('approved')
    expect(out.overallScore).toBeGreaterThanOrEqual(75)
    expect(out.checksPassed).toContain('word_count')
    expect(mockCallLLM).toHaveBeenCalledOnce()
  })

  it('uses fallback LLM score when callLLM throws', async () => {
    mockCallLLM.mockRejectedValue(new Error('rate limit'))
    const out = await runQA(goodInput())
    expect(out.qualityScore).toBe(70)
    expect(out.checksPassed.length).toBeGreaterThan(0)
    expect(mockCallLLM).toHaveBeenCalledOnce()
  })

  it('returns needs_revision when overall score is below 75 but not rejected', async () => {
    // With seo/read ~100/90, quality 40 → round(16+35+22.5)=74
    mockCallLLM.mockResolvedValue({ text: '{"score": 40, "issues": []}' })
    const out = await runQA(goodInput())
    expect(out.outcome).toBe('needs_revision')
    expect(out.overallScore).toBeGreaterThanOrEqual(60)
    expect(out.overallScore).toBeLessThan(75)
  })

  it('returns rejected when overall score is below 60 without blocking checks', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 0, "issues": []}' })
    const out = await runQA(goodInput())
    expect(out.outcome).toBe('rejected')
    expect(out.overallScore).toBeLessThan(60)
  })

  it('returns rejected when focus keyword is missing from title and body', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 90, "issues": []}' })
    const out = await runQA(
      goodInput({
        title: 'Generic article title only',
        contentMarkdown: 'Content with no target phrase repeated here.',
      })
    )
    expect(out.outcome).toBe('rejected')
    expect(out.checksFailed).toContain('keyword_presence')
    expect(out.blockingIssues.some((m) => m.includes('not found'))).toBe(true)
  })

  it('returns rejected when no H2 headings in HTML', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 90, "issues": []}' })
    const out = await runQA(
      goodInput({
        contentHtml: '<p>Only paragraphs, no sections.</p>',
      })
    )
    expect(out.outcome).toBe('rejected')
    expect(out.checksFailed).toContain('heading_structure')
  })

  it('warns when focus keyword appears only once (non-blocking)', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 92, "issues": []}' })
    const out = await runQA(
      goodInput({
        title: 'A generic guide for beginners',
        contentMarkdown:
          'Short para one.\n\nShort para two.\n\nOnly one widget kw in the whole piece.',
      })
    )
    expect(out.checksFailed).toContain('keyword_presence')
    expect(out.blockingIssues).toHaveLength(0)
    expect(out.warnings.some((w) => w.includes('only once'))).toBe(true)
    expect(out.outcome).toBe('approved')
  })

  it('warns when only one H2 section (non-blocking)', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 92, "issues": []}' })
    const out = await runQA(
      goodInput({
        contentHtml: '<h2>Only section</h2><p>Body with widget kw and more widget kw.</p>',
      })
    )
    expect(out.checksFailed).toContain('heading_structure')
    expect(out.blockingIssues).toHaveLength(0)
    expect(out.warnings.some((w) => w.includes('one H2'))).toBe(true)
    expect(out.outcome).toBe('approved')
  })

  it('warns when word count is below recommended 600', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 92, "issues": []}' })
    const out = await runQA(goodInput({ wordCount: 400 }))
    expect(out.checksFailed).toContain('word_count')
    expect(out.blockingIssues).toHaveLength(0)
    expect(out.warnings.some((w) => w.includes('below recommended'))).toBe(true)
    expect(out.outcome).toBe('approved')
  })

  it('warns when meta title is too long', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 92, "issues": []}' })
    const longTitle = `${'x'.repeat(60)} widget kw`
    expect(longTitle.length).toBeGreaterThan(65)
    const out = await runQA(goodInput({ metaTitle: longTitle }))
    expect(out.checksFailed).toContain('meta_tags')
    expect(out.blockingIssues).toHaveLength(0)
    expect(out.warnings.some((w) => w.includes('Meta title too long'))).toBe(true)
    expect(out.outcome).toBe('approved')
  })

  it('warns when meta description is too short', async () => {
    mockCallLLM.mockResolvedValue({ text: '{"score": 92, "issues": []}' })
    const out = await runQA(
      goodInput({
        metaDescription: 'Too short desc about widget kw here.',
      })
    )
    expect(out.checksFailed).toContain('meta_tags')
    expect(out.warnings.some((w) => w.includes('too short meta description'))).toBe(true)
  })
})

describe('saveQAReport', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('inserts report and updates article status', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_qa_reports') {
          return { insert }
        }
        if (t === 'scp_articles') {
          return buildUpdateEqThenChain({ error: null })
        }
        throw new Error(`unexpected ${t}`)
      }),
    })

    const result: QAResult = {
      overallScore: 88,
      qualityScore: 85,
      seoScore: 90,
      readabilityScore: 88,
      checksPassed: ['word_count'],
      checksFailed: [],
      blockingIssues: [],
      warnings: [],
      outcome: 'approved',
    }

    await saveQAReport('app-1', 'art-1', result)

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: 'app-1',
        article_id: 'art-1',
        overall_score: 88,
        outcome: 'approved',
      })
    )
  })

  it('sets article status to draft when outcome is rejected', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_qa_reports') return { insert }
        if (t === 'scp_articles') return { update }
        throw new Error(`unexpected ${t}`)
      }),
    })

    await saveQAReport('app-1', 'art-1', {
      overallScore: 40,
      qualityScore: 40,
      seoScore: 50,
      readabilityScore: 50,
      checksPassed: [],
      checksFailed: ['word_count'],
      blockingIssues: ['too short'],
      warnings: [],
      outcome: 'rejected',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        qa_score: 40,
      })
    )
  })

  it('sets article status to qa_review when outcome is needs_revision', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_qa_reports') return { insert }
        if (t === 'scp_articles') return { update }
        throw new Error(`unexpected ${t}`)
      }),
    })

    await saveQAReport('app-1', 'art-1', {
      overallScore: 70,
      qualityScore: 72,
      seoScore: 80,
      readabilityScore: 85,
      checksPassed: ['word_count'],
      checksFailed: [],
      blockingIssues: [],
      warnings: ['minor'],
      outcome: 'needs_revision',
    })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'qa_review',
        qa_score: 70,
      })
    )
  })
})
