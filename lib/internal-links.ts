import { createAdminClient } from '@/lib/supabase'

export interface LinkSuggestion {
  target_article_id: string
  target_slug: string
  anchor_text: string
  target_url: string
  relevance_score: number
  matched_keyword: string
}

export interface InternalLinkEdge {
  app_id: string
  from_article_id: string
  to_article_id: string
  to_slug: string
  anchor_text: string
  semantic_score: number
  inserted_by: 'generation' | 'refresh' | 'human'
}

/**
 * Build a keyword → article index for a given app, using published articles'
 * focus_keyword, secondary_keywords, title words, and tags.
 */
async function buildArticleIndex(appId: string): Promise<
  { article_id: string; slug: string; title: string; keyword: string; base_url: string }[]
> {
  const db = createAdminClient()

  const { data: app } = await db
    .from('scp_apps')
    .select('base_url')
    .eq('id', appId)
    .single()

  const baseUrl = (app?.base_url as string | null) ?? ''

  const { data: articles } = await db
    .from('scp_articles')
    .select('id, slug, title, focus_keyword, secondary_keywords, tags')
    .eq('app_id', appId)
    .in('status', ['delivered', 'approved', 'published'])

  const rows: { article_id: string; slug: string; title: string; keyword: string; base_url: string }[] = []

  for (const a of articles ?? []) {
    const keywords: string[] = [
      a.focus_keyword,
      ...((a.secondary_keywords as string[]) ?? []),
      ...((a.tags as string[]) ?? []),
    ].filter(Boolean).map((k: string) => k.toLowerCase().trim())

    for (const kw of keywords) {
      rows.push({ article_id: a.id, slug: a.slug, title: a.title, keyword: kw, base_url: baseUrl })
    }
  }

  return rows
}

/**
 * For a given article, find up to `maxLinks` other published articles that are
 * relevant based on keyword overlap with the article's content text.
 */
export async function suggestInternalLinks(
  appId: string,
  sourceArticleId: string,
  contentText: string,
  maxLinks = 5
): Promise<LinkSuggestion[]> {
  const index = await buildArticleIndex(appId)
  const lower = contentText.toLowerCase()

  const scores: Map<string, { suggestion: LinkSuggestion; score: number }> = new Map()

  for (const row of index) {
    if (row.article_id === sourceArticleId) continue

    // Check if the keyword phrase appears in the content text
    if (!lower.includes(row.keyword)) continue

    const existing = scores.get(row.article_id)
    const score = row.keyword.split(' ').length // longer phrase = higher relevance

    if (!existing || score > existing.score) {
      scores.set(row.article_id, {
        score,
        suggestion: {
          target_article_id: row.article_id,
          target_slug: row.slug,
          anchor_text: row.keyword,
          target_url: `${row.base_url}/blog/${row.slug}`,
          relevance_score: score,
          matched_keyword: row.keyword,
        },
      })
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLinks)
    .map((e) => e.suggestion)
}

/**
 * Inject internal links into HTML content by wrapping the first occurrence of
 * each anchor phrase with an <a> tag. Skips phrases already inside a tag.
 */
export function injectLinksIntoHtml(
  html: string,
  links: LinkSuggestion[]
): string {
  let result = html

  for (const link of links) {
    const anchor = link.anchor_text
    // Escape special regex chars in anchor text
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Only match text NOT already inside an <a ...> tag
    // Strategy: replace the first occurrence that is not preceded by href=" or >"
    const regex = new RegExp(`(?<!<a[^>]*>)(?<!["\\'=/])\\b(${escaped})\\b`, 'i')
    const replacement = `<a href="${link.target_url}" data-internal-link="true">${anchor}</a>`
    result = result.replace(regex, replacement)
  }

  return result
}

/**
 * Persist computed link edges to scp_internal_link_edges for the article graph.
 */
export async function saveInternalLinkEdges(
  appId: string,
  sourceArticleId: string,
  links: LinkSuggestion[]
): Promise<void> {
  if (links.length === 0) return
  const db = createAdminClient()

  const rows: InternalLinkEdge[] = links.map((l) => ({
    app_id: appId,
    from_article_id: sourceArticleId,
    to_article_id: l.target_article_id,
    to_slug: l.target_slug,
    anchor_text: l.anchor_text,
    semantic_score: l.relevance_score,
    inserted_by: 'generation' as const,
  }))

  await db
    .from('scp_internal_link_edges')
    .upsert(rows, { onConflict: 'from_article_id,to_article_id' })
}

/**
 * Full pipeline: suggest links, inject into HTML, save edges, return updated html + suggestions.
 */
export async function applyInternalLinks(
  appId: string,
  articleId: string,
  contentHtml: string,
  contentText: string,
  maxLinks = 5
): Promise<{ html: string; links: LinkSuggestion[] }> {
  const links = await suggestInternalLinks(appId, articleId, contentText, maxLinks)
  if (links.length === 0) return { html: contentHtml, links: [] }

  const html = injectLinksIntoHtml(contentHtml, links)
  await saveInternalLinkEdges(appId, articleId, links)

  return { html, links }
}
