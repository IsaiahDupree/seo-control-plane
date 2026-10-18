import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { runArticleGeneration, type ContentTypeOption } from '@/lib/generation-pipeline'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const contentTypeEnum = z.enum([
  'pillar',
  'cluster',
  'comparison',
  'alternatives',
  'faq',
  'guide',
  'case_study',
])

const bodySchema = z
  .object({
    brief_id: z.string().uuid().optional(),
    focus_keyword: z.string().min(2).max(200).optional(),
    secondary_keywords: z.array(z.string()).max(10).optional(),
    content_type: contentTypeEnum.optional(),
    cluster_name: z.string().max(100).optional(),
    target_word_count: z.number().int().min(300).max(8000).optional(),
    target_persona: z.string().max(200).optional(),
    tone_notes: z.string().max(500).optional(),
    cta_guidance: z.string().max(500).optional(),
    auto_deliver: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (!data.brief_id && !data.focus_keyword) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide focus_keyword or brief_id',
        path: ['focus_keyword'],
      })
    }
  })

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const db = createAdminClient()

  const { data: app, error: appErr } = await db
    .from('scp_apps')
    .select('id, slug, name, context, metadata, monthly_article_limit')
    .eq('id', appId)
    .single()

  if (appErr || !app) {
    return jsonError(404, 'app_not_found', 'App not found')
  }

  const briefId: string | null = parsed.data.brief_id ?? null
  let contentRequestId: string | null = null
  let focusKeyword = parsed.data.focus_keyword
  let secondaryKeywords = parsed.data.secondary_keywords ?? []
  let contentType: ContentTypeOption = parsed.data.content_type ?? 'cluster'
  let clusterName = parsed.data.cluster_name
  let targetWordCount = parsed.data.target_word_count ?? 1800
  let targetPersona = parsed.data.target_persona
  let toneNotes = parsed.data.tone_notes
  let ctaGuidance = parsed.data.cta_guidance

  if (briefId) {
    const { data: br, error: brErr } = await db
      .from('scp_content_briefs')
      .select(
        'id, status, focus_keyword, secondary_keywords, content_type, cluster_name, target_word_count, target_persona, tone_notes, cta_guidance, content_request_id'
      )
      .eq('id', briefId)
      .eq('app_id', appId)
      .single()

    if (brErr || !br) {
      return jsonError(404, 'brief_not_found', 'Brief not found')
    }
    if (br.status !== 'pending') {
      return jsonError(409, 'brief_not_pending', `Brief status is "${br.status}"; only pending briefs can be generated`)
    }

    contentRequestId = br.content_request_id as string | null
    focusKeyword = focusKeyword ?? br.focus_keyword
    if (!focusKeyword) {
      return jsonError(400, 'brief_invalid', 'Brief has no focus_keyword')
    }
    if (parsed.data.secondary_keywords === undefined && Array.isArray(br.secondary_keywords)) {
      secondaryKeywords = br.secondary_keywords as string[]
    }
    if (parsed.data.content_type === undefined && br.content_type) {
      contentType = br.content_type as ContentTypeOption
    }
    if (parsed.data.cluster_name === undefined && br.cluster_name) {
      clusterName = br.cluster_name as string
    }
    if (parsed.data.target_word_count === undefined && br.target_word_count) {
      targetWordCount = br.target_word_count
    }
    if (parsed.data.target_persona === undefined && br.target_persona) {
      targetPersona = br.target_persona as string
    }
    if (parsed.data.tone_notes === undefined && br.tone_notes) {
      toneNotes = br.tone_notes as string
    }
    if (parsed.data.cta_guidance === undefined && br.cta_guidance) {
      ctaGuidance = br.cta_guidance as string
    }
  } else if (!focusKeyword) {
    return jsonError(400, 'validation_error', 'focus_keyword is required without brief_id')
  }

  try {
    const result = await runArticleGeneration(
      appId,
      {
        name: app.name,
        context: (app.context as Record<string, unknown>) ?? {},
        metadata: (app.metadata as Record<string, unknown>) ?? {},
        monthly_article_limit: (app.monthly_article_limit as number) ?? 30,
      },
      {
        focus_keyword: focusKeyword,
        secondary_keywords: secondaryKeywords,
        content_type: contentType,
        cluster_name: clusterName,
        target_word_count: targetWordCount,
        target_persona: targetPersona,
        tone_notes: toneNotes,
        cta_guidance: ctaGuidance,
        auto_deliver: parsed.data.auto_deliver,
        brief_id: briefId,
        content_request_id: contentRequestId,
      }
    )

    const audit_warning = await tryInsertUserAudit(db, {
      app_id: appId,
      action: 'article.generated',
      entity_type: 'article',
      entity_id: result.article_id,
      performed_by: null,
      payload: {
        source: 'api_key',
        brief_id: briefId,
        focus_keyword: focusKeyword,
        slug: result.slug,
        content_type: contentType,
        auto_deliver: parsed.data.auto_deliver,
        qa_outcome: result.qa.outcome,
      },
    })

    return NextResponse.json({
      ...result,
      ...(audit_warning ? { audit_warning } : {}),
    })
  } catch (err) {
    if (err instanceof MonthlyArticleLimitExceededError) {
      return jsonError(429, err.code, err.message, {
        used: err.used,
        limit: err.limit,
      })
    }
    return jsonError(500, 'generation_failed', err instanceof Error ? err.message : 'Generation failed')
  }
}
