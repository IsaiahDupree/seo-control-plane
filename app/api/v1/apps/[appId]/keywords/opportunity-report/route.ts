// Keyword opportunity report — ranked list of highest-opportunity uncovered keywords
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const minVolume = parseInt(searchParams.get('min_volume') ?? '0', 10)
  const cluster = searchParams.get('cluster')
  const intentType = searchParams.get('intent_type')

  const admin = createAdminClient()

  let kwQuery = admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, search_volume, opportunity_score, intent_type, status, article_id, gsc_position')
    .eq('app_id', appId)
    .eq('status', 'active')
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (cluster) kwQuery = kwQuery.eq('cluster_name', cluster)
  if (intentType) kwQuery = kwQuery.eq('intent_type', intentType)
  if (minVolume > 0) kwQuery = kwQuery.gte('search_volume', minVolume)

  const [kwResult, artResult] = await Promise.all([
    kwQuery,
    admin.from('scp_articles').select('focus_keyword').eq('app_id', appId).not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const coveredKw = new Set(
    (artResult.data ?? []).map((a) => (a.focus_keyword as string | null)?.toLowerCase().trim()).filter(Boolean) as string[]
  )

  const uncovered = (kwResult.data ?? [])
    .filter((k) => !coveredKw.has(k.keyword.toLowerCase().trim()))
    .slice(0, limit)
    .map((k) => ({
      keyword_id: k.id,
      keyword: k.keyword,
      cluster_name: k.cluster_name ?? null,
      search_volume: k.search_volume ?? null,
      opportunity_score: k.opportunity_score ?? null,
      intent_type: k.intent_type ?? null,
      current_position: k.gsc_position ?? null,
      tier: (k.opportunity_score as number | null) !== null
        ? (k.opportunity_score as number) >= 70 ? 'high'
        : (k.opportunity_score as number) >= 40 ? 'medium'
        : 'low'
        : 'unknown',
    }))

  const byCluster = uncovered.reduce((acc: Record<string, number>, k) => {
    const c = k.cluster_name ?? 'Unclustered'
    acc[c] = (acc[c] ?? 0) + 1
    return acc
  }, {})

  const byTier = uncovered.reduce((acc: Record<string, number>, k) => {
    acc[k.tier] = (acc[k.tier] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    total_opportunities: uncovered.length,
    total_covered: coveredKw.size,
    by_cluster: byCluster,
    by_tier: byTier,
    opportunities: uncovered,
    generated_at: new Date().toISOString(),
  })
}
