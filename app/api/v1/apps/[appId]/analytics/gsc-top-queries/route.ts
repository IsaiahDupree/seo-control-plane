// GSC top queries — top performing search queries from GSC data
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
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '25', 10), 200)
  const sortBy = searchParams.get('sort_by') ?? 'clicks' // clicks | impressions | ctr | position

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('scp_gsc_performance')
    .select('query, clicks, impressions, ctr, avg_position, date')
    .eq('app_id', appId)
    .gte('date', since)
    .lte('date', until)
    .limit(50000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Aggregate by query
  const queryMap = new Map<string, { clicks: number; impressions: number; ctr_sum: number; ctr_count: number; pos_sum: number; pos_count: number; dates: number }>()

  for (const r of rows ?? []) {
    const q = r.query as string
    if (!queryMap.has(q)) queryMap.set(q, { clicks: 0, impressions: 0, ctr_sum: 0, ctr_count: 0, pos_sum: 0, pos_count: 0, dates: 0 })
    const e = queryMap.get(q)!
    e.clicks += (r.clicks as number) ?? 0
    e.impressions += (r.impressions as number) ?? 0
    if (r.ctr !== null) { e.ctr_sum += r.ctr as number; e.ctr_count++ }
    if (r.avg_position !== null) { e.pos_sum += r.avg_position as number; e.pos_count++ }
    e.dates++
  }

  let results = Array.from(queryMap.entries()).map(([query, d]) => ({
    query,
    total_clicks: d.clicks,
    total_impressions: d.impressions,
    avg_ctr: d.ctr_count > 0 ? Math.round((d.ctr_sum / d.ctr_count) * 10000) / 100 : 0,
    avg_position: d.pos_count > 0 ? Math.round((d.pos_sum / d.pos_count) * 10) / 10 : null,
    data_points: d.dates,
  }))

  if (sortBy === 'impressions') results = results.sort((a, b) => b.total_impressions - a.total_impressions)
  else if (sortBy === 'ctr') results = results.sort((a, b) => b.avg_ctr - a.avg_ctr)
  else if (sortBy === 'position') results = results.sort((a, b) => (a.avg_position ?? 999) - (b.avg_position ?? 999))
  else results = results.sort((a, b) => b.total_clicks - a.total_clicks)

  return NextResponse.json({
    period: { since, until },
    sort_by: sortBy,
    total_queries: results.length,
    top_queries: results.slice(0, limit),
  })
}
