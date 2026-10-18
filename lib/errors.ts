export class MonthlyArticleLimitExceededError extends Error {
  readonly code = 'monthly_limit_exceeded' as const

  constructor(
    readonly used: number,
    readonly limit: number
  ) {
    super(`Monthly article limit reached (${used}/${limit} this UTC month)`)
    this.name = 'MonthlyArticleLimitExceededError'
  }
}
