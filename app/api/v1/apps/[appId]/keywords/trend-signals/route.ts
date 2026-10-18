// Keyword trend signals — identifies rising, stable, and declining keywords from GSC data
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
  const windowDays = parseInt(searchParams.get('window_days') ?? '30', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  const now = new Date()
  const midpoint = new Date(now.getTime() - (windowDays / 2) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const start = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: gscRows, error } = await admin
    .from('scp_gsc_performance')
    .select('query, clicks, impressions, avg_position, date')
    .eq('app_id', appId)
    .gte('date', start)
    .order('date', { ascending: true })
    .limit(20000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Split into first half and second half of the window
  const firstHalf = new Map<string, { clicks: number; impressions: number; position_sum: number; count: number }>()
  const secondHalf = new Map<string, { clicks: number; impressions: number; position_sum: number; count: number }>()

  for (const row of gscRows ?? []) {
    const q = row.query as string
    const d = row.date as string
    const target = d < midpoint ? firstHalf : secondHalf

    if (!target.has(q)) target.set(q, { clicks: 0, impressions: 0, position_sum: 0, count: 0 })
    const entry = target.get(q)!
    entry.clicks += (row.clicks as number) ?? 0
    entry.impressions += (row.impressions as number) ?? 0
    entry.position_sum += (row.avg_position as number) ?? 0
    entry.count++
  }

  const allQueries = new Set([...firstHalf.keys(), ...secondHalf.keys()])

  const trends = Array.from(allQueries).map((q) => {
    const f = firstHalf.get(q) ?? { clicks: 0, impressions: 0, position_sum: 0, count: 1 }
    const s = secondHalf.get(q) ?? { clicks: 0, impressions: 0, position_sum: 0, count: 1 }

    const f_clicks = f.clicks
    const s_clicks = s.clicks
    const clickDelta = s_clicks - f_clicks
    const clickPctChange = f_clicks > 0 ? Math.round(((s_clicks - f_clicks) / f_clicks) * 100) : null

    const f_pos = f.count > 0 ? f.position_sum / f.count : null
    const s_pos = s.count > 0 ? s.position_sum / s.count : null
    const positionDelta = f_pos !== null && s_pos !== null ? Math.round((f_pos - s_pos) * 10) / 10 : null // positive = improving

    let signal: 'rising' | 'stable' | 'declining' | 'new'
    if (!firstHalf.has(q)) signal = 'new'
    else if (clickPctChange !== null && clickPctChange >= 20) signal = 'rising'
    else if (clickPctChange !== null && clickPctChange <= -20) signal = 'declining'
    else signal = 'stable'

    return {
      query: q,
      signal,
      first_half_clicks: f_clicks,
      second_half_clicks: s_clicks,
      click_delta: clickDelta,
      click_pct_change: clickPctChange,
      position_delta: positionDelta,
      current_avg_position: s_pos !== null ? Math.round(s_pos * 10) / 10 : null,
    }
  }).sort((a, b) => Math.abs(b.click_delta) - Math.abs(a.click_delta)).slice(0, limit)

  const bySig = (sig: string) => trends.filter((t) => t.signal === sig)

  return NextResponse.json({
    window_days: windowDays,
    total_queries: allQueries.size,
    summary: {
      rising: bySig('rising').length,
      stable: bySig('stable').length,
      declining: bySig('declining').length,
      new: bySig('new').length,
    },
    trends,
    analysed_at: new Date().toISOString(),
  })
}
