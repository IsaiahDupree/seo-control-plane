// GSC trend analytics — aggregate clicks, impressions, CTR, position over time
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
  const since = searchParams.get('since') ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)
  const granularity = searchParams.get('granularity') ?? 'week' // day | week | month

  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('scp_gsc_performance')
    .select('date, clicks, impressions, ctr, avg_position, query')
    .eq('app_id', appId)
    .gte('date', since)
    .lte('date', until)
    .order('date', { ascending: true })
    .limit(10000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Bucket by granularity
  const bucketKey = (dateStr: string): string => {
    const d = new Date(dateStr)
    if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (granularity === 'week') {
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(d.setDate(diff))
      return monday.toISOString().slice(0, 10)
    }
    return dateStr
  }

  const buckets = new Map<string, { clicks: number; impressions: number; ctr_sum: number; position_sum: number; count: number; queries: Set<string> }>()

  for (const row of rows ?? []) {
    const key = bucketKey(row.date as string)
    if (!buckets.has(key)) buckets.set(key, { clicks: 0, impressions: 0, ctr_sum: 0, position_sum: 0, count: 0, queries: new Set() })
    const b = buckets.get(key)!
    b.clicks += (row.clicks as number) ?? 0
    b.impressions += (row.impressions as number) ?? 0
    b.ctr_sum += (row.ctr as number) ?? 0
    b.position_sum += (row.avg_position as number) ?? 0
    b.count++
    if (row.query) b.queries.add(row.query as string)
  }

  const trend = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, b]) => ({
      period,
      clicks: b.clicks,
      impressions: b.impressions,
      avg_ctr: b.count > 0 ? Math.round((b.ctr_sum / b.count) * 10000) / 10000 : null,
      avg_position: b.count > 0 ? Math.round((b.position_sum / b.count) * 10) / 10 : null,
      unique_queries: b.queries.size,
    }))

  // Top queries overall
  const queryTotals = new Map<string, { clicks: number; impressions: number; avg_position: number; count: number }>()
  for (const row of rows ?? []) {
    if (!row.query) continue
    const q = row.query as string
    if (!queryTotals.has(q)) queryTotals.set(q, { clicks: 0, impressions: 0, avg_position: 0, count: 0 })
    const qt = queryTotals.get(q)!
    qt.clicks += (row.clicks as number) ?? 0
    qt.impressions += (row.impressions as number) ?? 0
    qt.avg_position += (row.avg_position as number) ?? 0
    qt.count++
  }

  const topQueries = Array.from(queryTotals.entries())
    .map(([q, t]) => ({ query: q, clicks: t.clicks, impressions: t.impressions, avg_position: t.count > 0 ? Math.round((t.avg_position / t.count) * 10) / 10 : null }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 20)

  return NextResponse.json({
    period: { since, until, granularity },
    trend,
    top_queries: topQueries,
    totals: {
      clicks: trend.reduce((s, t) => s + t.clicks, 0),
      impressions: trend.reduce((s, t) => s + t.impressions, 0),
    },
  })
}
