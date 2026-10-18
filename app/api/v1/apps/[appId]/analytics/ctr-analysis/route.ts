// CTR analysis — articles and keywords with low CTR relative to position (opportunity)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

// Expected CTR benchmarks by position
const EXPECTED_CTR: Record<number, number> = {
  1: 28, 2: 15, 3: 11, 4: 8, 5: 7, 6: 6, 7: 5, 8: 4.5, 9: 4, 10: 3.5,
}

function expectedCtr(position: number): number {
  const rounded = Math.round(position)
  return EXPECTED_CTR[Math.min(rounded, 10)] ?? 2
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 100)
  const mode = searchParams.get('mode') ?? 'underperforming' // underperforming | overperforming

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('scp_gsc_performance')
    .select('query, clicks, impressions, ctr, avg_position')
    .eq('app_id', appId)
    .gte('date', since)
    .not('avg_position', 'is', null)
    .not('ctr', 'is', null)
    .gt('impressions', 50) // meaningful volume
    .limit(50000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Aggregate by query
  const qMap = new Map<string, { clicks: number; impressions: number; ctr_sum: number; pos_sum: number; count: number }>()
  for (const r of rows ?? []) {
    const q = r.query as string
    if (!qMap.has(q)) qMap.set(q, { clicks: 0, impressions: 0, ctr_sum: 0, pos_sum: 0, count: 0 })
    const e = qMap.get(q)!
    e.clicks += (r.clicks as number) ?? 0
    e.impressions += (r.impressions as number) ?? 0
    e.ctr_sum += (r.ctr as number) ?? 0
    e.pos_sum += (r.avg_position as number) ?? 0
    e.count++
  }

  const analyzed = Array.from(qMap.entries())
    .map(([query, d]) => {
      const avgPos = d.pos_sum / d.count
      const avgCtr = (d.ctr_sum / d.count) * 100
      const expected = expectedCtr(avgPos)
      const ctrGap = avgCtr - expected
      return {
        query,
        avg_position: Math.round(avgPos * 10) / 10,
        avg_ctr_pct: Math.round(avgCtr * 100) / 100,
        expected_ctr_pct: expected,
        ctr_gap_pct: Math.round(ctrGap * 100) / 100,
        total_impressions: d.impressions,
        total_clicks: d.clicks,
        missed_clicks_estimate: ctrGap < 0
          ? Math.round((Math.abs(ctrGap) / 100) * d.impressions)
          : 0,
      }
    })

  const filtered = mode === 'overperforming'
    ? analyzed.filter((a) => a.ctr_gap_pct > 2).sort((a, b) => b.ctr_gap_pct - a.ctr_gap_pct)
    : analyzed.filter((a) => a.ctr_gap_pct < -2).sort((a, b) => a.ctr_gap_pct - b.ctr_gap_pct)

  return NextResponse.json({
    since,
    mode,
    total_analyzed: analyzed.length,
    results: filtered.slice(0, limit),
    total_missed_clicks: filtered.reduce((s, r) => s + r.missed_clicks_estimate, 0),
  })
}
