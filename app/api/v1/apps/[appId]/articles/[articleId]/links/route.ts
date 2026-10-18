import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { applyInternalLinks, suggestInternalLinks } from '@/lib/internal-links'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

/** GET — list current internal link edges for an article */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const db = createAdminClient()
  const { data, error } = await db
    .from('scp_internal_link_edges')
    .select('to_article_id, to_slug, anchor_text, semantic_score, created_at')
    .eq('from_article_id', articleId)
    .order('semantic_score', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ links: data ?? [] })
}

/** POST — (re)compute internal links for an article and optionally inject into HTML */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const db = createAdminClient()
  const { data: article, error: artErr } = await db
    .from('scp_articles')
    .select('id, slug, content_html, body_mdx, focus_keyword')
    .eq('id', articleId)
    .eq('app_id', appId)
    .single()

  if (artErr || !article) return jsonError(404, 'not_found', 'Article not found')

  const html = (article.content_html as string) ?? ''
  // Strip tags for text matching
  const text = html.replace(/<[^>]+>/g, ' ')

  let inject = false
  try {
    const body = await request.json()
    inject = body?.inject === true
  } catch { /* no body */ }

  if (inject) {
    const { html: updatedHtml, links } = await applyInternalLinks(appId, articleId, html, text)
    let contentUpdated = false
    if (updatedHtml !== html) {
      const { error: upErr } = await db
        .from('scp_articles')
        .update({ content_html: updatedHtml, updated_at: new Date().toISOString() })
        .eq('id', articleId)
      if (upErr) return jsonError(500, 'update_failed', upErr.message)
      contentUpdated = true
    }
    const audit_warning = await tryInsertUserAudit(db, {
      app_id: appId,
      action: 'article.internal_links_injected',
      entity_type: 'article',
      entity_id: articleId,
      performed_by: null,
      payload: {
        source: 'api_key',
        links_applied: links.length,
        content_html_updated: contentUpdated,
      },
    })
    return NextResponse.json({
      applied: links.length,
      links,
      ...(audit_warning ? { audit_warning } : {}),
    })
  }

  // Suggest only — do not mutate
  const links = await suggestInternalLinks(appId, articleId, text)
  return NextResponse.json({ suggested: links.length, links })
}
