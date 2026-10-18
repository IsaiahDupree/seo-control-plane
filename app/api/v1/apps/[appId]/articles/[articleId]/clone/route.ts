// Clone an article — duplicate with new slug and reset status to draft
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const cloneBody = z.object({
  new_slug: z.string().max(300).optional(),
  new_focus_keyword: z.string().max(300).optional(),
  new_title: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { json = {} }

  const parsed = cloneBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const { data: source, error: srcErr } = await admin
    .from('scp_articles')
    .select('*')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (srcErr) return jsonError(500, 'query_failed', srcErr.message)
  if (!source) return jsonError(404, 'not_found', 'Article not found')

  const now = new Date().toISOString()
  const newSlug = parsed.data.new_slug ?? `${(source.slug as string)}-copy-${Date.now()}`

  // Check slug uniqueness
  const { data: existing } = await admin
    .from('scp_articles')
    .select('id')
    .eq('app_id', appId)
    .eq('slug', newSlug)
    .maybeSingle()

  if (existing) return jsonError(409, 'slug_conflict', `Slug '${newSlug}' already exists`)

  const cloneData = {
    app_id: appId,
    slug: newSlug,
    title: parsed.data.new_title ?? `${source.title as string} (Copy)`,
    focus_keyword: parsed.data.new_focus_keyword ?? source.focus_keyword,
    status: 'draft',
    description: source.description,
    body_mdx: source.body_mdx,
    table_of_contents: source.table_of_contents,
    meta_title: source.meta_title,
    meta_description: source.meta_description,
    cluster_name: source.cluster_name,
    secondary_keywords: source.secondary_keywords,
    intent_type: source.intent_type,
    target_word_count: source.target_word_count,
    cta_blocks: source.cta_blocks,
    faq_schema: source.faq_schema,
    tags: source.tags,
    created_at: now,
    updated_at: now,
    // Reset publish/performance data
    published_at: null,
    canonical_url: null,
    gsc_clicks: null,
    gsc_impressions: null,
    gsc_avg_position: null,
    gsc_ctr: null,
    qa_score: null,
    brief_id: null,
    content_request_id: null,
  }

  const { data: clone, error: insertErr } = await admin
    .from('scp_articles')
    .insert(cloneData)
    .select('id, slug, title')
    .single()

  if (insertErr) return jsonError(500, 'insert_failed', insertErr.message)

  return NextResponse.json({
    cloned_from: articleId,
    new_article_id: clone.id,
    new_slug: clone.slug,
    new_title: clone.title,
    status: 'draft',
  }, { status: 201 })
}
