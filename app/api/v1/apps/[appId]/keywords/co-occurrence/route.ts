// F-CP-046: Keyword co-occurrence mapping
// Finds keywords that frequently appear together in article content and GSC queries.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const admin = createAdminClient()

  // Fetch active keywords
  const { data: keywords, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, search_volume')
    .eq('app_id', appId)
    .eq('status', 'active')
    .limit(2000)

  if (kwErr) return jsonError(500, 'query_failed', kwErr.message)

  // Fetch published articles to find co-occurrence in body text
  const { data: articles, error: artErr } = await admin
    .from('scp_articles')
    .select('id, body_mdx, focus_keyword')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .limit(500)

  if (artErr) return jsonError(500, 'articles_query_failed', artErr.message)

  const kwList = (keywords ?? []).map((k) => k.keyword.toLowerCase())
  const focusKw = keyword?.toLowerCase().trim()

  // For each article, find which keywords appear in body
  const coMatrix = new Map<string, Map<string, number>>()

  for (const article of articles ?? []) {
    const body = ((article.body_mdx as string) ?? '').toLowerCase()
    const present = kwList.filter((kw) => body.includes(kw))

    // Build pairwise co-occurrence counts
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i]
        const b = present[j]

        if (!coMatrix.has(a)) coMatrix.set(a, new Map())
        if (!coMatrix.has(b)) coMatrix.set(b, new Map())

        coMatrix.get(a)!.set(b, (coMatrix.get(a)!.get(b) ?? 0) + 1)
        coMatrix.get(b)!.set(a, (coMatrix.get(b)!.get(a) ?? 0) + 1)
      }
    }
  }

  if (focusKw) {
    // Return co-occurring keywords for the specific keyword
    const coMap = coMatrix.get(focusKw) ?? new Map<string, number>()
    const results = Array.from(coMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([kw, count]) => {
        const kwData = (keywords ?? []).find((k) => k.keyword === kw)
        return {
          keyword: kw,
          co_occurrence_count: count,
          cluster_name: kwData?.cluster_name ?? null,
          search_volume: kwData?.search_volume ?? null,
        }
      })

    return NextResponse.json({
      focus_keyword: focusKw,
      co_occurring_keywords: results,
      articles_analysed: (articles ?? []).length,
    })
  }

  // Return top co-occurring pairs across all keywords
  const pairs: Array<{ keyword_a: string; keyword_b: string; count: number }> = []
  const seen = new Set<string>()

  for (const [kwA, coMap] of coMatrix) {
    for (const [kwB, count] of coMap) {
      const pairKey = [kwA, kwB].sort().join('|||')
      if (!seen.has(pairKey)) {
        seen.add(pairKey)
        pairs.push({ keyword_a: kwA, keyword_b: kwB, count })
      }
    }
  }

  pairs.sort((a, b) => b.count - a.count)

  return NextResponse.json({
    top_pairs: pairs.slice(0, limit),
    total_pairs_found: pairs.length,
    articles_analysed: (articles ?? []).length,
    keywords_analysed: kwList.length,
  })
}
