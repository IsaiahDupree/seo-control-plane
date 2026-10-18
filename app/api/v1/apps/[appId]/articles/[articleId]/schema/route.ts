// Article schema.org JSON-LD — get and update structured data for an article
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const schemaBody = z.object({
  schema_json: z.record(z.string(), z.unknown()),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, schema_json, focus_keyword, published_at, canonical_url')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  // Build a default Article schema if none stored
  const storedSchema = (article.schema_json && Object.keys(article.schema_json as object).length > 0)
    ? article.schema_json
    : null

  const defaultSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    keywords: article.focus_keyword ?? undefined,
    datePublished: article.published_at ?? undefined,
    url: article.canonical_url ?? undefined,
  }

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    schema_json: storedSchema ?? defaultSchema,
    is_custom: storedSchema !== null,
  })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = schemaBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_articles')
    .update({ schema_json: parsed.data.schema_json, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ article_id: articleId, schema_json: parsed.data.schema_json })
}
