// F-CP-060: Keyword-to-article mapping endpoint
// Shows which articles cover each keyword (via focus_keyword or body mention).
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
  const uncoveredOnly = searchParams.get('uncovered_only') === 'true'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 1000)

  const admin = createAdminClient()

  const [kwResult, artResult] = await Promise.all([
    admin
      .from('scp_keywords')
      .select('id, keyword, cluster_name, search_volume, opportunity_score, status, intent_type')
      .eq('app_id', appId)
      .eq('status', 'active')
      .order('opportunity_score', { ascending: false, nullsFirst: false })
      .limit(limit),
    admin
      .from('scp_articles')
      .select('id, slug, title, focus_keyword, status, cluster_name')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived')
      .limit(5000),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const keywords = kwResult.data ?? []
  const articles = artResult.data ?? []

  // Build focus_keyword lookup
  const focusKwMap = new Map<string, typeof articles>()
  for (const a of articles) {
    if (!a.focus_keyword) continue
    const kw = (a.focus_keyword as string).toLowerCase().trim()
    if (!focusKwMap.has(kw)) focusKwMap.set(kw, [])
    focusKwMap.get(kw)!.push(a)
  }

  // Filter to a specific keyword if requested
  const kwList = keyword
    ? keywords.filter((k) => k.keyword === keyword.toLowerCase().trim())
    : keywords

  const mapping = kwList.map((k) => {
    const kw = k.keyword.toLowerCase().trim()
    const coveringArticles = focusKwMap.get(kw) ?? []
    const covered = coveringArticles.length > 0

    return {
      keyword: k.keyword,
      keyword_id: k.id,
      cluster_name: k.cluster_name ?? null,
      intent_type: k.intent_type ?? null,
      search_volume: k.search_volume ?? null,
      opportunity_score: k.opportunity_score ?? null,
      covered,
      article_count: coveringArticles.length,
      articles: coveringArticles.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        status: a.status,
      })),
    }
  })

  const filtered = uncoveredOnly ? mapping.filter((m) => !m.covered) : mapping

  const coveredCount = mapping.filter((m) => m.covered).length
  const uncoveredCount = mapping.length - coveredCount

  return NextResponse.json({
    total_keywords: mapping.length,
    covered: coveredCount,
    uncovered: uncoveredCount,
    coverage_pct: mapping.length > 0 ? Math.round((coveredCount / mapping.length) * 100) : 0,
    mapping: filtered,
  })
}
