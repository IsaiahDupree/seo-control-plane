import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { MonthlyArticleLimitExceededError } from '@/lib/errors'
import {
  executeBriefGeneration,
  AppNotFoundError,
  BriefNotFoundError,
  BriefNotPendingError,
} from '@/lib/execute-brief-generation'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; briefId: string }> }

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
    target_word_count: z.number().int().min(300).max(8000).optional(),
    target_persona: z.string().max(200).optional(),
    tone_notes: z.string().max(500).optional(),
    cta_guidance: z.string().max(500).optional(),
    content_type: contentTypeEnum.optional(),
    auto_deliver: z.boolean().optional(),
  })
  .optional()

/** Generate one article from a pending brief (same pipeline as POST /generate with brief_id). */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, briefId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown = {}
  try {
    const text = await request.text()
    if (text) json = JSON.parse(text)
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const overrides = parsed.data ?? {}

  try {
    const result = await executeBriefGeneration(appId, briefId, overrides)
    const admin = createAdminClient()
    const audit_warning = await tryInsertUserAudit(admin, {
      app_id: appId,
      action: 'article.generated',
      entity_type: 'article',
      entity_id: result.article_id,
      performed_by: null,
      payload: {
        source: 'api_key',
        brief_id: briefId,
        slug: result.slug,
        qa_outcome: result.qa.outcome,
      },
    })
    return NextResponse.json({
      ...result,
      ...(audit_warning ? { audit_warning } : {}),
    })
  } catch (err) {
    if (err instanceof AppNotFoundError) {
      return jsonError(404, 'app_not_found', err.message)
    }
    if (err instanceof BriefNotFoundError) {
      return jsonError(404, 'brief_not_found', err.message)
    }
    if (err instanceof BriefNotPendingError) {
      return jsonError(409, 'brief_not_pending', err.message)
    }
    if (err instanceof MonthlyArticleLimitExceededError) {
      return jsonError(429, err.code, err.message, {
        used: err.used,
        limit: err.limit,
      })
    }
    return jsonError(500, 'generation_failed', err instanceof Error ? err.message : 'Generation failed')
  }
}
