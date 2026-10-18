import { createAdminClient } from '@/lib/supabase'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import {
  executeBriefGeneration,
  AppNotFoundError,
  BriefNotFoundError,
  BriefNotPendingError,
  type BriefGenerationOverrides,
} from '@/lib/execute-brief-generation'

export type ProcessedBrief = { brief_id: string; article_id: string; slug: string; title: string }
export type FailedBrief = { brief_id: string; code: string; message: string }

export type ProcessPendingBriefsResult =
  | { kind: 'success'; processed: ProcessedBrief[]; failures: FailedBrief[] }
  | { kind: 'empty' }
  | {
      kind: 'monthly_limit'
      used: number
      limit: number
      partial: ProcessedBrief[]
    }
  | { kind: 'query_failed'; message: string }
  | { kind: 'app_not_found' }

export async function runProcessPendingBriefsBatch(
  appId: string,
  limit: number,
  overrides: BriefGenerationOverrides = {}
): Promise<ProcessPendingBriefsResult> {
  const admin = createAdminClient()
  const { data: briefRows, error: listErr } = await admin
    .from('scp_content_briefs')
    .select('id')
    .eq('app_id', appId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (listErr) {
    return { kind: 'query_failed', message: listErr.message }
  }

  const ids = (briefRows ?? []).map((r) => r.id)
  if (ids.length === 0) {
    return { kind: 'empty' }
  }

  const processed: ProcessedBrief[] = []
  const failures: FailedBrief[] = []

  for (const briefId of ids) {
    try {
      const result = await executeBriefGeneration(appId, briefId, overrides)
      processed.push({
        brief_id: briefId,
        article_id: result.article_id,
        slug: result.slug,
        title: result.title,
      })
    } catch (err) {
      if (err instanceof MonthlyArticleLimitExceededError) {
        return {
          kind: 'monthly_limit',
          used: err.used,
          limit: err.limit,
          partial: processed,
        }
      }
      if (err instanceof AppNotFoundError) {
        return { kind: 'app_not_found' }
      }
      if (err instanceof BriefNotFoundError) {
        failures.push({ brief_id: briefId, code: 'brief_not_found', message: err.message })
        continue
      }
      if (err instanceof BriefNotPendingError) {
        failures.push({ brief_id: briefId, code: 'brief_not_pending', message: err.message })
        continue
      }
      failures.push({
        brief_id: briefId,
        code: 'generation_failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return { kind: 'success', processed, failures }
}
