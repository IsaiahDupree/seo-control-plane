import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchArticleBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const articleColumns =
  'id, app_id, slug, title, description, status, body_mdx, content_html, content_markdown, meta_title, meta_description, meta_json, og_image_url, canonical_url, focus_keyword, secondary_keywords, content_type, cluster_name, word_count, reading_time_minutes, author, schema_json, table_of_contents, cta_blocks, internal_links, tags, qa_score, scheduled_publish_at, published_at, delivery_version, created_at, updated_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_articles')
    .select(articleColumns)
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }
  if (!data) {
    return jsonError(404, 'not_found', 'Article not found')
  }

  return NextResponse.json({ article: data })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchArticleBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: existing, error: exErr } = await admin
    .from('scp_articles')
    .select('id, status')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (exErr) return jsonError(500, 'query_failed', exErr.message)
  if (!existing) return jsonError(404, 'not_found', 'Article not found')

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  const p = parsed.data
  if (p.status !== undefined) patch.status = p.status
  if (p.tags !== undefined) patch.tags = p.tags
  if (p.scheduled_publish_at !== undefined) patch.scheduled_publish_at = p.scheduled_publish_at
  if (p.meta_title !== undefined) patch.meta_title = p.meta_title
  if (p.meta_description !== undefined) patch.meta_description = p.meta_description
  if (p.canonical_url !== undefined) patch.canonical_url = p.canonical_url
  if (p.title !== undefined) patch.title = p.title
  if (p.description !== undefined) patch.description = p.description

  const { data: updated, error: updErr } = await admin
    .from('scp_articles')
    .update(patch)
    .eq('id', articleId)
    .eq('app_id', appId)
    .select(articleColumns)
    .single()

  if (updErr) return jsonError(500, 'update_failed', updErr.message)

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'article.patch',
    entity_type: 'article',
    entity_id: articleId,
    performed_by: null,
    payload: {
      before: { status: existing.status },
      changes: parsed.data,
      source: 'api_key',
    },
  })

  return NextResponse.json({
    article: updated,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
