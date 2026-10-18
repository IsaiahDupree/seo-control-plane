import { createAdminClient } from '@/lib/supabase'
import { generateArticle, saveGeneratedArticle, type ArticleSaveMeta } from '@/lib/generate'
import { runQA, saveQAReport } from '@/lib/qa'
import { deliverArticle } from '@/lib/deliver'
import { assertMonthlyArticleAllowance } from '@/lib/monthly-limit'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'

export type ContentTypeOption =
  | 'pillar'
  | 'cluster'
  | 'comparison'
  | 'alternatives'
  | 'faq'
  | 'guide'
  | 'case_study'

export type RunGenerationInput = {
  focus_keyword: string
  secondary_keywords: string[]
  content_type: ContentTypeOption
  cluster_name?: string
  target_word_count: number
  target_persona?: string
  tone_notes?: string
  cta_guidance?: string
  auto_deliver: boolean
  brief_id: string | null
  content_request_id: string | null
}

export type RunGenerationAppRow = {
  name: string
  context: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  /** From scp_apps.monthly_article_limit; values ≤0 or ≥10000 skip enforcement. */
  monthly_article_limit: number
}

export type RunGenerationResult = {
  article_id: string
  slug: string
  title: string
  word_count: number
  reading_time_minutes: number
  qa: {
    score: number
    outcome: string
    blocking_issues: string[]
    warnings: string[]
  }
  generation: {
    model: string
    tokens: number
    cost_usd: number
  }
  delivery: { success: boolean; deliveryId: string; error?: string } | null
}

export async function runArticleGeneration(
  appId: string,
  app: RunGenerationAppRow,
  params: RunGenerationInput
): Promise<RunGenerationResult> {
  const db = createAdminClient()
  const appContext = (app.context as Record<string, unknown>) ?? {}
  const meta = (app.metadata as Record<string, unknown>) ?? {}

  await assertMonthlyArticleAllowance(db, appId, app.monthly_article_limit)

  if (params.brief_id) {
    const { error: stErr } = await db
      .from('scp_content_briefs')
      .update({ status: 'generating' })
      .eq('id', params.brief_id)
      .eq('app_id', appId)
    if (stErr) throw new Error(stErr.message)
  }

  try {
    const briefInput = {
      appId,
      focusKeyword: params.focus_keyword,
      secondaryKeywords: params.secondary_keywords,
      contentType: params.content_type,
      clusterName: params.cluster_name ?? '',
      targetWordCount: params.target_word_count,
      targetPersona:
        params.target_persona ??
        (appContext.target_personas as string[])?.[0] ??
        'general audience',
      toneNotes: params.tone_notes ?? (appContext.brand_voice as string) ?? '',
      ctaGuidance: params.cta_guidance ?? '',
      appContext: {
        description:
          (appContext.description as string) ??
          (meta.description as string) ??
          `${app.name} — a Vercel web application`,
        targetPersonas: (appContext.target_personas as string[]) ?? [],
        brandVoice: (appContext.brand_voice as string) ?? undefined,
        features: (appContext.features as string[]) ?? undefined,
        prohibitedPhrases: (appContext.prohibited_phrases as string[]) ?? undefined,
      },
    }

    const generationResult = await generateArticle(briefInput)

    const metaSave: ArticleSaveMeta = {
      focusKeyword: params.focus_keyword,
      secondaryKeywords: params.secondary_keywords,
      contentType: params.content_type,
      clusterName: params.cluster_name,
    }

    const articleId = await saveGeneratedArticle(
      appId,
      params.brief_id,
      params.content_request_id,
      generationResult,
      metaSave
    )

    const qaResult = await runQA({
      articleId,
      appId,
      title: generationResult.title,
      contentHtml: generationResult.contentHtml,
      contentMarkdown: generationResult.contentMarkdown,
      metaTitle: generationResult.metaTitle,
      metaDescription: generationResult.metaDescription,
      focusKeyword: params.focus_keyword,
      wordCount: generationResult.wordCount,
      contentType: params.content_type,
    })
    await saveQAReport(appId, articleId, qaResult)

    if (params.brief_id) {
      const { data: br } = await db
        .from('scp_content_briefs')
        .select('keyword_id, content_request_id')
        .eq('id', params.brief_id)
        .single()

      await db
        .from('scp_content_briefs')
        .update({ article_id: articleId, status: 'complete' })
        .eq('id', params.brief_id)
        .eq('app_id', appId)

      if (br?.keyword_id) {
        await db
          .from('scp_keywords')
          .update({ article_id: articleId, status: 'assigned' })
          .eq('id', br.keyword_id)
          .eq('app_id', appId)
      }

      const rid = (br?.content_request_id as string | null) ?? params.content_request_id
      if (rid) await maybeMarkRequestFulfilled(db, rid)
    }

    let deliveryResult: { success: boolean; deliveryId: string; error?: string } | null = null
    if (params.auto_deliver && qaResult.outcome === 'approved') {
      deliveryResult = await deliverArticle(articleId, appId)
    }

    return {
      article_id: articleId,
      slug: generationResult.slug,
      title: generationResult.title,
      word_count: generationResult.wordCount,
      reading_time_minutes: generationResult.readingTimeMinutes,
      qa: {
        score: qaResult.overallScore,
        outcome: qaResult.outcome,
        blocking_issues: qaResult.blockingIssues,
        warnings: qaResult.warnings,
      },
      generation: {
        model: generationResult.llmModel,
        tokens: generationResult.totalTokens,
        cost_usd: generationResult.costUsd,
      },
      delivery: deliveryResult,
    }
  } catch (err) {
    if (params.brief_id && !(err instanceof MonthlyArticleLimitExceededError)) {
      await db
        .from('scp_content_briefs')
        .update({ status: 'pending' })
        .eq('id', params.brief_id)
        .eq('app_id', appId)
    }
    throw err
  }
}

async function maybeMarkRequestFulfilled(
  db: ReturnType<typeof createAdminClient>,
  requestId: string
): Promise<void> {
  const { data: briefs, error } = await db
    .from('scp_content_briefs')
    .select('status')
    .eq('content_request_id', requestId)

  if (error || !briefs?.length) return

  const allComplete = briefs.every((b) => b.status === 'complete')
  if (!allComplete) return

  await db.from('scp_content_requests').update({ status: 'fulfilled' }).eq('id', requestId)
}
