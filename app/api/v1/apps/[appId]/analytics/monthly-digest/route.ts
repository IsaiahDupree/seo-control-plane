// F-CP-062: Monthly digest / analytics summary endpoint
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
  const now = new Date()
  const year = parseInt(searchParams.get('year') ?? String(now.getFullYear()), 10)
  const month = parseInt(searchParams.get('month') ?? String(now.getMonth() + 1), 10)

  if (isNaN(year) || year < 2020 || year > 2100) return jsonError(400, 'invalid_year', 'Year out of range')
  if (isNaN(month) || month < 1 || month > 12) return jsonError(400, 'invalid_month', 'Month must be 1-12')

  const from = new Date(year, month - 1, 1).toISOString()
  const to = new Date(year, month, 0, 23, 59, 59).toISOString()

  const admin = createAdminClient()

  const [
    publishedRes,
    deliveredRes,
    failedRes,
    keywordsAddedRes,
    brietsCreatedRes,
    gscRes,
    topArticlesRes,
  ] = await Promise.all([
    admin.from('scp_articles').select('id', { count: 'exact', head: true })
      .eq('app_id', appId).gte('published_at', from).lte('published_at', to),
    admin.from('scp_deliveries').select('id', { count: 'exact', head: true })
      .eq('app_id', appId).eq('status', 'delivered').gte('created_at', from).lte('created_at', to),
    admin.from('scp_deliveries').select('id', { count: 'exact', head: true })
      .eq('app_id', appId).eq('status', 'failed').gte('created_at', from).lte('created_at', to),
    admin.from('scp_keywords').select('id', { count: 'exact', head: true })
      .eq('app_id', appId).gte('created_at', from).lte('created_at', to),
    admin.from('scp_briefs').select('id', { count: 'exact', head: true })
      .eq('app_id', appId).gte('created_at', from).lte('created_at', to),
    admin.from('scp_gsc_performance').select('impressions, clicks, avg_position')
      .eq('app_id', appId).gte('date', from.slice(0, 10)).lte('date', to.slice(0, 10)),
    admin.from('scp_articles').select('id, slug, title, gsc_clicks, gsc_avg_position, focus_keyword')
      .eq('app_id', appId).gte('published_at', from).lte('published_at', to)
      .order('gsc_clicks', { ascending: false }).limit(5),
  ])

  const gscRows = gscRes.data ?? []
  const totalImpressions = gscRows.reduce((s, r) => s + (r.impressions ?? 0), 0)
  const totalClicks = gscRows.reduce((s, r) => s + (r.clicks ?? 0), 0)
  const avgPosition = gscRows.length > 0
    ? Math.round((gscRows.reduce((s, r) => s + (r.avg_position ?? 0), 0) / gscRows.length) * 10) / 10
    : null

  return NextResponse.json({
    period: { year, month, from, to },
    articles: {
      published: publishedRes.count ?? 0,
      top_articles: topArticlesRes.data ?? [],
    },
    deliveries: {
      delivered: deliveredRes.count ?? 0,
      failed: failedRes.count ?? 0,
      success_rate: (deliveredRes.count ?? 0) + (failedRes.count ?? 0) > 0
        ? Math.round(((deliveredRes.count ?? 0) / ((deliveredRes.count ?? 0) + (failedRes.count ?? 0))) * 100)
        : null,
    },
    keywords: { added: keywordsAddedRes.count ?? 0 },
    briefs: { created: brietsCreatedRes.count ?? 0 },
    gsc: {
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      avg_position: avgPosition,
      ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : null,
    },
    generated_at: new Date().toISOString(),
  })
}
