// F-CP-073: Coverage gap report
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

  const [keywordsResult, articlesResult] = await Promise.all([
    admin
      .from('scp_keywords')
      .select('id, keyword, search_volume, difficulty, intent_type, cluster_name, status, opportunity_score')
      .eq('app_id', appId)
      .eq('status', 'active'),
    admin
      .from('scp_articles')
      .select('id, focus_keyword, status, gsc_avg_position')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked']),
  ])

  if (keywordsResult.error) return jsonError(500, 'query_failed', keywordsResult.error.message)
  if (articlesResult.error) return jsonError(500, 'query_failed', articlesResult.error.message)

  const keywords = keywordsResult.data ?? []
  const articles = articlesResult.data ?? []

  // Build a set of covered keywords (normalised)
  const coveredKeywords = new Set(
    articles
      .map((a) => a.focus_keyword?.toLowerCase().trim())
      .filter(Boolean)
  )

  const total = keywords.length
  const withArticle = keywords.filter((k) =>
    coveredKeywords.has(k.keyword.toLowerCase().trim())
  ).length

  // Ranking = has article + GSC position recorded
  const rankedKeywords = new Set(
    articles
      .filter((a) => a.gsc_avg_position != null && a.gsc_avg_position <= 100)
      .map((a) => a.focus_keyword?.toLowerCase().trim())
      .filter(Boolean)
  )
  const ranking = keywords.filter((k) =>
    rankedKeywords.has(k.keyword.toLowerCase().trim())
  ).length

  // Owned = top-3
  const ownedKeywords = new Set(
    articles
      .filter((a) => a.gsc_avg_position != null && a.gsc_avg_position <= 3)
      .map((a) => a.focus_keyword?.toLowerCase().trim())
      .filter(Boolean)
  )
  const owned = keywords.filter((k) =>
    ownedKeywords.has(k.keyword.toLowerCase().trim())
  ).length

  // Top-20 unaddressed opportunities
  const unaddressed = keywords
    .filter((k) => !coveredKeywords.has(k.keyword.toLowerCase().trim()))
    .sort((a, b) => {
      const scoreA = a.opportunity_score ?? 0
      const scoreB = b.opportunity_score ?? 0
      if (scoreB !== scoreA) return scoreB - scoreA
      return (b.search_volume ?? 0) - (a.search_volume ?? 0)
    })
    .slice(0, 20)
    .map((k) => ({
      keyword: k.keyword,
      search_volume: k.search_volume,
      difficulty: k.difficulty,
      intent_type: k.intent_type,
      cluster_name: k.cluster_name,
      opportunity_score: k.opportunity_score,
    }))

  return NextResponse.json({
    summary: {
      total_keywords: total,
      with_published_article: withArticle,
      pct_covered: total > 0 ? Math.round((withArticle / total) * 100) : 0,
      ranking: ranking,
      pct_ranking: total > 0 ? Math.round((ranking / total) * 100) : 0,
      owned_top_3: owned,
      pct_owned: total > 0 ? Math.round((owned / total) * 100) : 0,
      unaddressed_count: total - withArticle,
    },
    top_opportunities: unaddressed,
  })
}
