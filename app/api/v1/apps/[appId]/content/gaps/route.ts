// Content gaps — keywords that have no article covering them
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
  const cluster = searchParams.get('cluster')
  const intentType = searchParams.get('intent_type')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500)
  const minVolume = parseInt(searchParams.get('min_volume') ?? '0', 10)

  const admin = createAdminClient()

  let kwQuery = admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, search_volume, opportunity_score, intent_type, status')
    .eq('app_id', appId)
    .eq('status', 'active')
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(5000)

  if (cluster) kwQuery = kwQuery.eq('cluster_name', cluster)
  if (intentType) kwQuery = kwQuery.eq('intent_type', intentType)
  if (minVolume > 0) kwQuery = kwQuery.gte('search_volume', minVolume)

  const [kwResult, artResult] = await Promise.all([
    kwQuery,
    admin
      .from('scp_articles')
      .select('focus_keyword, secondary_keywords, status')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const articles = artResult.data ?? []

  // Build set of covered keywords
  const covered = new Set<string>()
  for (const a of articles) {
    if (a.focus_keyword) covered.add((a.focus_keyword as string).toLowerCase().trim())
    for (const sk of (a.secondary_keywords as string[]) ?? []) {
      covered.add(sk.toLowerCase().trim())
    }
  }

  const gaps = (kwResult.data ?? [])
    .filter((k) => !covered.has(k.keyword.toLowerCase().trim()))
    .slice(0, limit)
    .map((k) => ({
      keyword_id: k.id,
      keyword: k.keyword,
      cluster_name: k.cluster_name ?? null,
      search_volume: k.search_volume ?? null,
      opportunity_score: k.opportunity_score ?? null,
      intent_type: k.intent_type ?? null,
    }))

  const clusterBreakdown = gaps.reduce((acc: Record<string, number>, g) => {
    const c = g.cluster_name ?? 'Unclustered'
    acc[c] = (acc[c] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    total_gaps: gaps.length,
    total_covered: covered.size,
    coverage_pct: (kwResult.data ?? []).length > 0
      ? Math.round((covered.size / Math.max(covered.size + gaps.length, 1)) * 100)
      : 0,
    by_cluster: clusterBreakdown,
    gaps,
  })
}
