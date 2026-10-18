import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'

const mockCreateAdminClient = vi.hoisted(() => vi.fn())
const mockExecuteBriefGeneration = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

vi.mock('@/lib/execute-brief-generation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/execute-brief-generation')>()
  return {
    ...actual,
    executeBriefGeneration: (...args: unknown[]) => mockExecuteBriefGeneration(...args),
  }
})

import {
  AppNotFoundError,
  BriefNotFoundError,
  BriefNotPendingError,
} from '@/lib/execute-brief-generation'
import { runProcessPendingBriefsBatch } from './process-pending-briefs'

function listBriefsChain(result: { data: unknown; error: unknown }) {
  const terminal = {
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (r: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue(terminal),
          }),
        }),
      }),
    }),
  }
}

describe('runProcessPendingBriefsBatch', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns query_failed when list query errors', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({ data: null, error: { message: 'timeout' } })
      ),
    })
    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out).toEqual({ kind: 'query_failed', message: 'timeout' })
  })

  it('returns empty when no pending briefs', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => listBriefsChain({ data: [], error: null })),
    })
    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out).toEqual({ kind: 'empty' })
  })

  it('returns success with processed rows when generation succeeds', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({
          data: [{ id: 'b1' }, { id: 'b2' }],
          error: null,
        })
      ),
    })
    mockExecuteBriefGeneration
      .mockResolvedValueOnce({
        article_id: 'a1',
        slug: 's1',
        title: 'T1',
      })
      .mockResolvedValueOnce({
        article_id: 'a2',
        slug: 's2',
        title: 'T2',
      })

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out.kind).toBe('success')
    if (out.kind === 'success') {
      expect(out.processed).toHaveLength(2)
      expect(out.failures).toEqual([])
      expect(out.processed[0]).toMatchObject({
        brief_id: 'b1',
        article_id: 'a1',
        slug: 's1',
        title: 'T1',
      })
    }
    expect(mockExecuteBriefGeneration).toHaveBeenCalledTimes(2)
  })

  it('returns monthly_limit when MonthlyArticleLimitExceededError is thrown', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({ data: [{ id: 'b1' }, { id: 'b2' }], error: null })
      ),
    })
    mockExecuteBriefGeneration
      .mockResolvedValueOnce({
        article_id: 'a1',
        slug: 's1',
        title: 'T1',
      })
      .mockRejectedValueOnce(new MonthlyArticleLimitExceededError(10, 10))

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out).toEqual({
      kind: 'monthly_limit',
      used: 10,
      limit: 10,
      partial: [
        {
          brief_id: 'b1',
          article_id: 'a1',
          slug: 's1',
          title: 'T1',
        },
      ],
    })
  })

  it('returns app_not_found when AppNotFoundError is thrown', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => listBriefsChain({ data: [{ id: 'b1' }], error: null })),
    })
    mockExecuteBriefGeneration.mockRejectedValueOnce(new AppNotFoundError())

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out).toEqual({ kind: 'app_not_found' })
  })

  it('records brief_not_found and continues', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({ data: [{ id: 'b1' }, { id: 'b2' }], error: null })
      ),
    })
    mockExecuteBriefGeneration
      .mockRejectedValueOnce(new BriefNotFoundError())
      .mockResolvedValueOnce({
        article_id: 'a2',
        slug: 'ok',
        title: 'OK',
      })

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out.kind).toBe('success')
    if (out.kind === 'success') {
      expect(out.failures).toEqual([
        { brief_id: 'b1', code: 'brief_not_found', message: 'Brief not found' },
      ])
      expect(out.processed).toHaveLength(1)
      expect(out.processed[0].brief_id).toBe('b2')
    }
  })

  it('records brief_not_pending and continues', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({ data: [{ id: 'b1' }], error: null })
      ),
    })
    mockExecuteBriefGeneration.mockRejectedValueOnce(
      new BriefNotPendingError('approved')
    )

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out.kind).toBe('success')
    if (out.kind === 'success') {
      expect(out.failures[0].code).toBe('brief_not_pending')
      expect(out.failures[0].message).toContain('approved')
      expect(out.processed).toHaveLength(0)
    }
  })

  it('records generation_failed for generic errors', async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() =>
        listBriefsChain({ data: [{ id: 'b1' }], error: null })
      ),
    })
    mockExecuteBriefGeneration.mockRejectedValueOnce(new Error('LLM down'))

    const out = await runProcessPendingBriefsBatch('app-1', 10)
    expect(out.kind).toBe('success')
    if (out.kind === 'success') {
      expect(out.failures).toEqual([
        { brief_id: 'b1', code: 'generation_failed', message: 'LLM down' },
      ])
    }
  })
})
