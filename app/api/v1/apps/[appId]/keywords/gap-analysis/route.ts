// F-CP-047: Competitor keyword gap analysis
// Identifies keywords competitors rank for that this app does not yet have an article covering.
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
  const domain = searchParams.get('domain') // filter to one competitor
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  // Get all competitor SERP data for this app
  let serpQuery = admin
    .from('scp_competitor_serps')
    .select('keyword, competitor_domain, rank_position, page_url, page_title, fetched_at')
    .eq('app_id', appId)
    .lte('rank_position', 30)
    .order('rank_position', { ascending: true })
    .limit(5000)

  if (domain) serpQuery = serpQuery.eq('competitor_domain', domain)

  const [serpResult, keywordsResult, articlesResult] = await Promise.all([
    serpQuery,
    // Our own keyword database
    admin
      .from('scp_keywords')
      .select('keyword, status, opportunity_score, search_volume, difficulty, intent_type')
      .eq('app_id', appId),
    // Published articles (focus keywords we already cover)
    admin
      .from('scp_articles')
      .select('focus_keyword')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked']),
  ])

  if (serpResult.error) return jsonError(500, 'query_failed', serpResult.error.message)

  const serpRows = serpResult.data ?? []
  const ownKeywords = new Set(
    (keywordsResult.data ?? []).map((k) => k.keyword.toLowerCase().trim())
  )
  const coveredKeywords = new Set(
    (articlesResult.data ?? [])
      .map((a) => a.focus_keyword?.toLowerCase().trim())
      .filter(Boolean)
  )

  // Build a lookup for our keyword metadata
  const kwMeta = new Map(
    (keywordsResult.data ?? []).map((k) => [k.keyword.toLowerCase().trim(), k])
  )

  // Aggregate: keywords competitors rank for, grouped by keyword
  const gapMap = new Map<
    string,
    {
      keyword: string
      competitors: Array<{ domain: string; rank: number; url: string | null; title: string | null }>
      min_competitor_rank: number
      in_our_db: boolean
      covered_by_article: boolean
      opportunity_score: number | null
      search_volume: number | null
      difficulty: number | null
      intent_type: string | null
    }
  >()

  for (const row of serpRows) {
    const kw = row.keyword.toLowerCase().trim()
    if (!gapMap.has(kw)) {
      const meta = kwMeta.get(kw)
      gapMap.set(kw, {
        keyword: kw,
        competitors: [],
        min_competitor_rank: row.rank_position,
        in_our_db: ownKeywords.has(kw),
        covered_by_article: coveredKeywords.has(kw),
        opportunity_score: meta?.opportunity_score ?? null,
        search_volume: meta?.search_volume ?? null,
        difficulty: meta?.difficulty ?? null,
        intent_type: meta?.intent_type ?? null,
      })
    }
    const entry = gapMap.get(kw)!
    entry.competitors.push({
      domain: row.competitor_domain,
      rank: row.rank_position,
      url: row.page_url ?? null,
      title: row.page_title ?? null,
    })
    entry.min_competitor_rank = Math.min(entry.min_competitor_rank, row.rank_position)
  }

  // Filter to actual gaps: not covered by an article
  const gaps = Array.from(gapMap.values())
    .filter((g) => !g.covered_by_article)
    .sort((a, b) => {
      // Sort by: number of competitors ranking first, then min rank
      const compDiff = b.competitors.length - a.competitors.length
      if (compDiff !== 0) return compDiff
      return a.min_competitor_rank - b.min_competitor_rank
    })
    .slice(0, limit)

  // Summary stats
  const totalCompetitorKeywords = gapMap.size
  const trueGaps = Array.from(gapMap.values()).filter((g) => !g.covered_by_article).length

  return NextResponse.json({
    summary: {
      total_competitor_keywords: totalCompetitorKeywords,
      already_covered: totalCompetitorKeywords - trueGaps,
      gaps: trueGaps,
      filter_domain: domain ?? 'all',
    },
    gaps,
  })
}
