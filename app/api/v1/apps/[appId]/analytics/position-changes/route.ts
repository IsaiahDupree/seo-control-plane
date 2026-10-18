// Position changes — keywords that significantly moved up or down in ranking
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
  const days = Math.min(parseInt(searchParams.get('days') ?? '30', 10), 90)
  const minChange = parseInt(searchParams.get('min_change') ?? '3', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const direction = searchParams.get('direction') // 'up' | 'down' | null

  const admin = createAdminClient()

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const { data: rows, error } = await admin
    .from('scp_gsc_performance')
    .select('query, avg_position, date')
    .eq('app_id', appId)
    .gte('date', cutoff)
    .order('date', { ascending: true })
    .limit(100000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // For each query, compare earliest vs latest position
  const queryDates = new Map<string, { earliest: { date: string; pos: number } | null; latest: { date: string; pos: number } | null }>()

  for (const r of rows ?? []) {
    const q = r.query as string
    const pos = r.avg_position as number
    const date = r.date as string
    if (!queryDates.has(q)) queryDates.set(q, { earliest: null, latest: null })
    const entry = queryDates.get(q)!
    if (!entry.earliest || date < entry.earliest.date) entry.earliest = { date, pos }
    if (!entry.latest || date > entry.latest.date) entry.latest = { date, pos }
  }

  let changes = Array.from(queryDates.entries())
    .filter(([, v]) => v.earliest && v.latest && v.earliest.date !== v.latest.date)
    .map(([query, v]) => {
      const change = v.earliest!.pos - v.latest!.pos // positive = improved (lower position is better)
      return {
        query,
        position_start: v.earliest!.pos,
        position_end: v.latest!.pos,
        position_change: Math.round(change * 10) / 10,
        direction: change > 0 ? 'improved' : 'declined',
        pct_change: v.earliest!.pos > 0 ? Math.round((Math.abs(change) / v.earliest!.pos) * 100) : 0,
        period_days: days,
      }
    })
    .filter((c) => Math.abs(c.position_change) >= minChange)

  if (direction === 'up') changes = changes.filter((c) => c.direction === 'improved')
  if (direction === 'down') changes = changes.filter((c) => c.direction === 'declined')

  changes = changes.sort((a, b) => Math.abs(b.position_change) - Math.abs(a.position_change)).slice(0, limit)

  return NextResponse.json({
    period_days: days,
    min_change_threshold: minChange,
    direction_filter: direction ?? null,
    total_changes: changes.length,
    improved: changes.filter((c) => c.direction === 'improved').length,
    declined: changes.filter((c) => c.direction === 'declined').length,
    changes,
  })
}
