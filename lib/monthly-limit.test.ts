import { describe, expect, it, vi } from 'vitest'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import {
  assertMonthlyArticleAllowance,
  countArticlesThisUtcMonth,
  isUnlimitedMonthlyLimit,
} from './monthly-limit'

function mockDbForCount(result: { count: number | null; error: unknown }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          gte: vi.fn().mockResolvedValue(result),
        }),
      }),
    })),
  }
}

describe('monthly-limit', () => {
  describe('isUnlimitedMonthlyLimit', () => {
    it('treats non-positive limit as unlimited', () => {
      expect(isUnlimitedMonthlyLimit(0)).toBe(true)
      expect(isUnlimitedMonthlyLimit(-1)).toBe(true)
    })

    it('treats very large limit as unlimited', () => {
      expect(isUnlimitedMonthlyLimit(10_000)).toBe(true)
      expect(isUnlimitedMonthlyLimit(50_000)).toBe(true)
    })

    it('treats mid-range positive limit as capped', () => {
      expect(isUnlimitedMonthlyLimit(1)).toBe(false)
      expect(isUnlimitedMonthlyLimit(99)).toBe(false)
      expect(isUnlimitedMonthlyLimit(9999)).toBe(false)
    })
  })

  describe('countArticlesThisUtcMonth', () => {
    it('returns count from head query', async () => {
      const db = mockDbForCount({ count: 7, error: null }) as never
      const n = await countArticlesThisUtcMonth(db, 'app-uuid')
      expect(n).toBe(7)
    })

    it('returns 0 when count is null', async () => {
      const db = mockDbForCount({ count: null, error: null }) as never
      const n = await countArticlesThisUtcMonth(db, 'app-uuid')
      expect(n).toBe(0)
    })

    it('throws when Supabase returns error', async () => {
      const db = mockDbForCount({ count: null, error: { message: 'timeout' } }) as never
      await expect(countArticlesThisUtcMonth(db, 'app-uuid')).rejects.toThrow('timeout')
    })
  })

  describe('assertMonthlyArticleAllowance', () => {
    it('no-ops when limit is unlimited', async () => {
      const db = { from: vi.fn() }
      await assertMonthlyArticleAllowance(db as never, 'app', 0)
      expect(db.from).not.toHaveBeenCalled()
    })

    it('no-ops when under limit', async () => {
      const db = mockDbForCount({ count: 2, error: null }) as never
      await assertMonthlyArticleAllowance(db, 'app', 10)
    })

    it('throws MonthlyArticleLimitExceededError at limit', async () => {
      const db = mockDbForCount({ count: 5, error: null }) as never
      await expect(assertMonthlyArticleAllowance(db, 'app', 5)).rejects.toMatchObject({
        code: 'monthly_limit_exceeded',
        used: 5,
        limit: 5,
      })
      await expect(assertMonthlyArticleAllowance(db, 'app', 5)).rejects.toBeInstanceOf(
        MonthlyArticleLimitExceededError
      )
    })
  })
})
