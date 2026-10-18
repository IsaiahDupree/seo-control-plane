// Article meta — get and update SEO meta fields (title, description, og_image, canonical)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const metaBody = z.object({
  meta_title: z.string().max(120).optional(),
  meta_description: z.string().max(320).optional(),
  og_image_url: z.string().url().optional(),
  canonical_url: z.string().url().optional(),
  focus_keyword: z.string().max(200).optional(),
  secondary_keywords: z.array(z.string().max(200)).max(20).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, meta_title, meta_description, og_image_url, canonical_url, focus_keyword, secondary_keywords')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    title: article.title,
    meta_title: article.meta_title ?? null,
    meta_description: article.meta_description ?? null,
    og_image_url: article.og_image_url ?? null,
    canonical_url: article.canonical_url ?? null,
    focus_keyword: article.focus_keyword ?? null,
    secondary_keywords: article.secondary_keywords ?? [],
  })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = metaBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  if (Object.keys(parsed.data).length === 0) {
    return jsonError(400, 'no_fields', 'At least one field is required')
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_articles')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ article_id: articleId, updated: parsed.data })
}
