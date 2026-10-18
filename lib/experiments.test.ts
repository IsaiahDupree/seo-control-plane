import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import {
  computeSignificance,
  concludeExperiment,
  evaluateExperiment,
} from './experiments'

describe('experiments', () => {
  describe('computeSignificance', () => {
    it('returns 0 when either side has no sessions', () => {
      expect(computeSignificance(1, 0, 1, 10)).toBe(0)
      expect(computeSignificance(1, 10, 1, 0)).toBe(0)
    })

    it('returns a value in 0–100 for typical inputs', () => {
      const s = computeSignificance(5, 100, 25, 100)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    })
  })

  describe('evaluateExperiment', () => {
    it('uses zero CR when sessions are zero', () => {
      const r = evaluateExperiment({
        control_conversions: 0,
        variant_conversions: 0,
        control_sessions: 0,
        variant_sessions: 0,
      })
      expect(r.control_cr).toBe(0)
      expect(r.variant_cr).toBe(0)
      expect(r.delta_pct).toBe(0)
      expect(r.winner).toBeNull()
    })

    it('returns null winner when rates are identical', () => {
      const r = evaluateExperiment({
        control_conversions: 10,
        variant_conversions: 10,
        control_sessions: 100,
        variant_sessions: 100,
      })
      expect(r.winner).toBeNull()
      expect(r.control_cr).toBe(0.1)
      expect(r.variant_cr).toBe(0.1)
    })
  })

  describe('concludeExperiment', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('returns error when experiment row missing', async () => {
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } }),
              }),
            }),
          }),
        })),
      })
      const out = await concludeExperiment('e1', 'a1', false)
      expect(out.ok).toBe(false)
      expect(out.error).toBe('Experiment not found')
    })

    it('returns early when already concluded', async () => {
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn(() => ({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    status: 'concluded',
                    winner: 'variant',
                    control_conversions: 1,
                    variant_conversions: 2,
                    control_sessions: 10,
                    variant_sessions: 10,
                  },
                  error: null,
                }),
              }),
            }),
          }),
        })),
      })
      const out = await concludeExperiment('e1', 'a1', false)
      expect(out.ok).toBe(true)
      expect(out.winner).toBe('variant')
    })

    it('updates experiment to concluded when running', async () => {
      let experimentsFrom = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((t: string) => {
          if (t !== 'scp_experiments') throw new Error(`unexpected ${t}`)
          experimentsFrom += 1
          if (experimentsFrom === 1) {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: {
                        status: 'running',
                        article_id: 'art-1',
                        variant_type: 'cta_text',
                        control_value: 'A',
                        variant_value: 'B',
                        control_conversions: 10,
                        variant_conversions: 10,
                        control_sessions: 100,
                        variant_sessions: 100,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            }
          }
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }
        }),
      })
      const out = await concludeExperiment('e1', 'a1', false)
      expect(out.ok).toBe(true)
      expect(experimentsFrom).toBe(2)
    })

    it('updates article title when applyWinner and mappable variant_type', async () => {
      let experimentsFrom = 0
      let articlesFrom = 0
      mockCreateAdminClient.mockReturnValue({
        from: vi.fn((t: string) => {
          if (t === 'scp_experiments') {
            experimentsFrom += 1
            if (experimentsFrom === 1) {
              return {
                select: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: {
                          status: 'running',
                          article_id: 'art-1',
                          variant_type: 'title',
                          control_value: 'Old',
                          variant_value: 'New Title',
                          control_conversions: 0,
                          variant_conversions: 50,
                          control_sessions: 100,
                          variant_sessions: 100,
                        },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }
            }
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }
          }
          if (t === 'scp_articles') {
            articlesFrom += 1
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }
          }
          throw new Error(`unexpected ${t}`)
        }),
      })
      const out = await concludeExperiment('e1', 'a1', true)
      expect(out.ok).toBe(true)
      expect(experimentsFrom).toBe(2)
      expect(articlesFrom).toBe(1)
    })
  })
})
