// Keyword ranking distribution — position bucket breakdown (1-3, 4-10, 11-20, 21-50, 51+)
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

  const { data: rows, error } = await admin
    .from('scp_gsc_performance')
    .select('query, avg_position, clicks, impressions')
    .eq('app_id', appId)
    .gte('date', since)
    .not('avg_position', 'is', null)
    .limit(50000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // De-duplicate by query — take best position
  const queryBest = new Map<string, { position: number; clicks: number; impressions: number }>()
  for (const r of rows ?? []) {
    const q = r.query as string
    const pos = r.avg_position as number
    if (!queryBest.has(q) || pos < queryBest.get(q)!.position) {
      queryBest.set(q, { position: pos, clicks: (r.clicks as number) ?? 0, impressions: (r.impressions as number) ?? 0 })
    }
  }

  const BUCKETS = [
    { label: '1-3', min: 1, max: 3 },
    { label: '4-10', min: 4, max: 10 },
    { label: '11-20', min: 11, max: 20 },
    { label: '21-50', min: 21, max: 50 },
    { label: '51-100', min: 51, max: 100 },
    { label: '100+', min: 101, max: Infinity },
  ]

  const distribution = BUCKETS.map((bucket) => {
    const matches = Array.from(queryBest.values()).filter((v) => v.position >= bucket.min && v.position <= bucket.max)
    return {
      position_range: bucket.label,
      keyword_count: matches.length,
      total_clicks: matches.reduce((s, m) => s + m.clicks, 0),
      total_impressions: matches.reduce((s, m) => s + m.impressions, 0),
    }
  })

  const total = Array.from(queryBest.values()).length

  return NextResponse.json({
    since,
    total_keywords_tracked: total,
    distribution,
    top_positions_pct: total > 0
      ? Math.round(((distribution[0].keyword_count + distribution[1].keyword_count) / total) * 100)
      : 0,
  })
}
