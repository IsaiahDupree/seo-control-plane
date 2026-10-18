// Share of voice — our click share vs competitors across tracked keywords
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
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const admin = createAdminClient()

  const [gscResult, serpResult] = await Promise.all([
    admin
      .from('scp_gsc_performance')
      .select('query, clicks, impressions')
      .eq('app_id', appId)
      .gte('date', since)
      .limit(50000),
    admin
      .from('scp_competitor_serp')
      .select('domain, keyword_id')
      .eq('app_id', appId)
      .lte('position', 10),
  ])

  if (gscResult.error) return jsonError(500, 'query_failed', gscResult.error.message)

  // Our total clicks and impressions
  const ourClicks = (gscResult.data ?? []).reduce((s, r) => s + ((r.clicks as number) ?? 0), 0)
  const ourImpressions = (gscResult.data ?? []).reduce((s, r) => s + ((r.impressions as number) ?? 0), 0)

  // Competitor presence count
  const competitorMap = new Map<string, number>()
  for (const r of serpResult.data ?? []) {
    const d = r.domain as string
    competitorMap.set(d, (competitorMap.get(d) ?? 0) + 1)
  }

  const totalKeywordsTracked = new Set((serpResult.data ?? []).map((r) => r.keyword_id as string)).size

  const competitors = Array.from(competitorMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([domain, count]) => ({
      domain,
      keywords_in_top10: count,
      estimated_sov_pct: totalKeywordsTracked > 0
        ? Math.round((count / totalKeywordsTracked) * 100)
        : 0,
    }))

  return NextResponse.json({
    period_since: since,
    our_metrics: {
      total_clicks: ourClicks,
      total_impressions: ourImpressions,
      keywords_with_impressions: new Set((gscResult.data ?? []).map((r) => r.query)).size,
    },
    competitors,
    total_tracked_keywords: totalKeywordsTracked,
  })
}
