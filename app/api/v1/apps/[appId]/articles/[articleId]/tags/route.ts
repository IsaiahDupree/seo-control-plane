// F-CP-071: Article tag management
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const tagsBody = z.object({
  tags: z.array(z.string().min(1).max(80)).min(1).max(30),
  replace: z.boolean().default(false),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, tags')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const tags = (article.tags as string[] | null) ?? []
  return NextResponse.json({ article_id: articleId, slug: article.slug, tags, count: tags.length })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = tagsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, tags')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const prevTags = parsed.data.replace ? [] : ((article.tags as string[] | null) ?? [])
  const merged = Array.from(new Set([...prevTags, ...parsed.data.tags]))

  const { error: updateErr } = await admin
    .from('scp_articles')
    .update({ tags: merged, updated_at: new Date().toISOString() })
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ article_id: articleId, tags: merged, count: merged.length })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const tag = request.nextUrl.searchParams.get('tag')
  if (!tag) return jsonError(400, 'missing_tag', 'Provide ?tag= to remove')

  const admin = createAdminClient()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, tags')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const updated = ((article.tags as string[] | null) ?? []).filter((t) => t !== tag)

  const { error: updateErr } = await admin
    .from('scp_articles')
    .update({ tags: updated, updated_at: new Date().toISOString() })
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ article_id: articleId, removed: tag, tags: updated, count: updated.length })
}
