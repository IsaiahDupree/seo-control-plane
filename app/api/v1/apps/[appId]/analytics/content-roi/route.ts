// Content ROI — estimated return on investment per article based on traffic value and cost
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
  const cpcUsd = parseFloat(searchParams.get('avg_cpc_usd') ?? '2.50')
  const costPerArticle = parseFloat(searchParams.get('cost_per_article_usd') ?? '150')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 200)
  const cluster = searchParams.get('cluster')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, slug, title, cluster_name, published_at, gsc_clicks, gsc_impressions, gsc_avg_position, word_count')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .order('gsc_clicks', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (cluster) query = query.eq('cluster_name', cluster)

  const { data: articles, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const results = (articles ?? []).map((a) => {
    const clicks = (a.gsc_clicks as number) ?? 0
    const trafficValue = clicks * cpcUsd
    const roi = costPerArticle > 0
      ? Math.round(((trafficValue - costPerArticle) / costPerArticle) * 100)
      : null

    return {
      article_id: a.id,
      slug: a.slug,
      title: a.title,
      cluster_name: a.cluster_name ?? null,
      published_at: a.published_at,
      gsc_clicks: clicks,
      gsc_avg_position: a.gsc_avg_position ?? null,
      word_count: a.word_count ?? null,
      estimated_traffic_value_usd: Math.round(trafficValue * 100) / 100,
      cost_per_article_usd: costPerArticle,
      estimated_roi_pct: roi,
      payback_clicks_needed: cpcUsd > 0 ? Math.ceil(costPerArticle / cpcUsd) : null,
    }
  })

  const totalTrafficValue = results.reduce((s, r) => s + r.estimated_traffic_value_usd, 0)
  const totalCost = results.length * costPerArticle

  return NextResponse.json({
    assumptions: { avg_cpc_usd: cpcUsd, cost_per_article_usd: costPerArticle },
    summary: {
      articles_analyzed: results.length,
      total_estimated_traffic_value_usd: Math.round(totalTrafficValue * 100) / 100,
      total_estimated_cost_usd: Math.round(totalCost * 100) / 100,
      portfolio_roi_pct: totalCost > 0 ? Math.round(((totalTrafficValue - totalCost) / totalCost) * 100) : null,
    },
    articles: results,
  })
}
