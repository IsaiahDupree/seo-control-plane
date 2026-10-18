// Per-article FAQ — get and update FAQ blocks for structured data
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const faqBody = z.object({
  faqs: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(2000),
  })).min(1).max(20),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, faq_schema')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    faqs: article.faq_schema ?? [],
  })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = faqBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_articles')
    .update({ faq_schema: parsed.data.faqs, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ article_id: articleId, faqs: parsed.data.faqs })
}
