// F-CP-052: Keyword cannibalization detection
// Identifies 2+ published articles from the same app competing for the same focus keyword.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, focus_keyword, status, gsc_avg_position, published_at, updated_at')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .not('focus_keyword', 'is', null)
    .order('published_at', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)

  // Group articles by normalised focus keyword
  const kwMap = new Map<
    string,
    Array<{
      id: string
      slug: string
      title: string
      focus_keyword: string
      status: string
      gsc_avg_position: number | null
      published_at: string | null
      updated_at: string
    }>
  >()

  for (const article of articles ?? []) {
    const kw = (article.focus_keyword as string).toLowerCase().trim()
    if (!kwMap.has(kw)) kwMap.set(kw, [])
    kwMap.get(kw)!.push(article as typeof articles[number] & { gsc_avg_position: number | null })
  }

  // Only keywords with 2+ articles are cannibalization candidates
  const cannibalized = Array.from(kwMap.entries())
    .filter(([, arts]) => arts.length >= 2)
    .map(([keyword, arts]) => {
      // Suggest the best-ranking article to keep
      const ranked = [...arts].sort((a, b) => {
        const posA = a.gsc_avg_position ?? 999
        const posB = b.gsc_avg_position ?? 999
        return posA - posB
      })

      return {
        keyword,
        article_count: arts.length,
        suggested_canonical: ranked[0]
          ? { id: ranked[0].id, slug: ranked[0].slug, title: ranked[0].title, gsc_position: ranked[0].gsc_avg_position }
          : null,
        articles: arts.map((a) => ({
          id: a.id,
          slug: a.slug,
          title: a.title,
          status: a.status,
          gsc_avg_position: a.gsc_avg_position,
          published_at: a.published_at,
        })),
        resolution_options: [
          'consolidate: merge content into strongest article and 301 redirect others',
          'redirect: 301 redirect weaker articles to canonical',
          'differentiate: update each article to target a distinct long-tail keyword variant',
        ],
      }
    })
    .sort((a, b) => b.article_count - a.article_count)

  return NextResponse.json({
    cannibalization_count: cannibalized.length,
    total_articles_checked: (articles ?? []).length,
    conflicts: cannibalized,
  })
}
