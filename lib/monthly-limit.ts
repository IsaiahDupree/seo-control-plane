import type { SupabaseClient } from '@supabase/supabase-js'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'

function utcMonthStartIso(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

/** Articles created this calendar month (UTC) for the app. */
export async function countArticlesThisUtcMonth(
  db: SupabaseClient,
  appId: string
): Promise<number> {
  const { count, error } = await db
    .from('scp_articles')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)
    .gte('created_at', utcMonthStartIso())

  if (error) throw new Error(error.message)
  return count ?? 0
}

const UNLIMITED_THRESHOLD = 10_000

export function isUnlimitedMonthlyLimit(limit: number): boolean {
  return limit <= 0 || limit >= UNLIMITED_THRESHOLD
}

export async function assertMonthlyArticleAllowance(
  db: SupabaseClient,
  appId: string,
  monthlyArticleLimit: number
): Promise<void> {
  if (isUnlimitedMonthlyLimit(monthlyArticleLimit)) return

  const used = await countArticlesThisUtcMonth(db, appId)
  if (used >= monthlyArticleLimit) {
    throw new MonthlyArticleLimitExceededError(used, monthlyArticleLimit)
  }
}
