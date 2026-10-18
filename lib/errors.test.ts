import { describe, expect, it } from 'vitest'
import { MonthlyArticleLimitExceededError } from './errors'

describe('errors', () => {
  it('MonthlyArticleLimitExceededError exposes code and fields', () => {
    const err = new MonthlyArticleLimitExceededError(10, 10)
    expect(err.name).toBe('MonthlyArticleLimitExceededError')
    expect(err.code).toBe('monthly_limit_exceeded')
    expect(err.used).toBe(10)
    expect(err.limit).toBe(10)
    expect(err.message).toContain('10/10')
  })
})
