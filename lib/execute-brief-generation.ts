import { createAdminClient } from '@/lib/supabase'
import {
  runArticleGeneration,
  type ContentTypeOption,
  type RunGenerationResult,
} from '@/lib/generation-pipeline'

export type BriefGenerationOverrides = {
  target_word_count?: number
  target_persona?: string
  tone_notes?: string
  cta_guidance?: string
  content_type?: ContentTypeOption
  auto_deliver?: boolean
}

export class BriefNotFoundError extends Error {
  constructor() {
    super('Brief not found')
    this.name = 'BriefNotFoundError'
  }
}

export class BriefNotPendingError extends Error {
  constructor(public readonly status: string) {
    super(`Brief status is "${status}"; only pending briefs can be generated`)
    this.name = 'BriefNotPendingError'
  }
}

export class AppNotFoundError extends Error {
  constructor() {
    super('App not found')
    this.name = 'AppNotFoundError'
  }
}

/**
 * Run the full generation pipeline for a single brief (used by API routes and batch workers).
 */
export async function executeBriefGeneration(
  appId: string,
  briefId: string,
  overrides: BriefGenerationOverrides = {}
): Promise<RunGenerationResult> {
  const db = createAdminClient()

  const { data: app, error: appErr } = await db
    .from('scp_apps')
    .select('id, name, context, metadata, monthly_article_limit')
    .eq('id', appId)
    .single()

  if (appErr || !app) throw new AppNotFoundError()

  const { data: br, error: brErr } = await db
    .from('scp_content_briefs')
    .select(
      'id, status, focus_keyword, secondary_keywords, content_type, cluster_name, target_word_count, target_persona, tone_notes, cta_guidance, content_request_id'
    )
    .eq('id', briefId)
    .eq('app_id', appId)
    .single()

  if (brErr || !br) throw new BriefNotFoundError()
  if (br.status !== 'pending') throw new BriefNotPendingError(br.status)

  const contentType = (overrides.content_type ?? br.content_type ?? 'cluster') as ContentTypeOption

  return runArticleGeneration(
    appId,
    {
      name: app.name,
      context: (app.context as Record<string, unknown>) ?? {},
      metadata: (app.metadata as Record<string, unknown>) ?? {},
      monthly_article_limit: (app.monthly_article_limit as number) ?? 30,
    },
    {
      focus_keyword: br.focus_keyword,
      secondary_keywords: (br.secondary_keywords as string[]) ?? [],
      content_type: contentType,
      cluster_name: (br.cluster_name as string) ?? undefined,
      target_word_count: overrides.target_word_count ?? br.target_word_count ?? 1800,
      target_persona: overrides.target_persona ?? (br.target_persona as string) ?? undefined,
      tone_notes: overrides.tone_notes ?? (br.tone_notes as string) ?? undefined,
      cta_guidance: overrides.cta_guidance ?? (br.cta_guidance as string) ?? undefined,
      auto_deliver: overrides.auto_deliver ?? false,
      brief_id: briefId,
      content_request_id: br.content_request_id as string | null,
    }
  )
}
