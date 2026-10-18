// Article outline — get and update structured outline (H2/H3 sections)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const sectionSchema = z.object({
  heading: z.string().max(300),
  level: z.number().int().min(2).max(4).default(2),
  notes: z.string().max(1000).optional(),
  keyword_target: z.string().max(200).optional(),
})

const outlineBody = z.object({
  sections: z.array(sectionSchema).min(1).max(50),
  total_target_words: z.number().int().min(100).max(20000).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, table_of_contents, focus_keyword, target_word_count')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    title: article.title,
    focus_keyword: article.focus_keyword ?? null,
    target_word_count: article.target_word_count ?? null,
    outline: article.table_of_contents ?? [],
  })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = outlineBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const updatePayload: Record<string, unknown> = {
    table_of_contents: parsed.data.sections,
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.total_target_words !== undefined) {
    updatePayload.target_word_count = parsed.data.total_target_words
  }

  const { error } = await admin
    .from('scp_articles')
    .update(updatePayload)
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({
    article_id: articleId,
    sections: parsed.data.sections,
    section_count: parsed.data.sections.length,
  })
}
