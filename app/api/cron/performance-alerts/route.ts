// F-CP-075/076: Weekly performance alerts + GSC position drop detection cron
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

const POSITION_DROP_THRESHOLD = 5   // alert if position worsened by this many spots
const MIN_IMPRESSIONS_TO_ALERT = 50  // only alert on keywords with meaningful impressions

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Get all active apps
  const { data: apps, error: appsErr } = await admin
    .from('scp_apps')
    .select('id, name, context')
    .eq('status', 'active')

  if (appsErr) return NextResponse.json({ error: appsErr.message }, { status: 500 })

  const now = new Date()
  const thisWeekStart = new Date(now)
  thisWeekStart.setDate(now.getDate() - 7)
  const lastWeekStart = new Date(now)
  lastWeekStart.setDate(now.getDate() - 14)

  const alerts: Array<{
    app_id: string
    app_name: string
    type: string
    keyword: string
    prev_position: number
    curr_position: number
    drop: number
    impressions: number
  }> = []

  for (const app of apps ?? []) {
    const appId = app.id

    // Fetch this week's GSC data
    const [thisWeekRes, lastWeekRes] = await Promise.all([
      admin
        .from('scp_gsc_performance')
        .select('query, avg_position, impressions')
        .eq('app_id', appId)
        .gte('date', thisWeekStart.toISOString().slice(0, 10))
        .lte('date', now.toISOString().slice(0, 10)),
      admin
        .from('scp_gsc_performance')
        .select('query, avg_position, impressions')
        .eq('app_id', appId)
        .gte('date', lastWeekStart.toISOString().slice(0, 10))
        .lt('date', thisWeekStart.toISOString().slice(0, 10)),
    ])

    // Aggregate by keyword — take avg
    const aggregate = (rows: typeof thisWeekRes.data) => {
      const map = new Map<string, { totalPos: number; totalImpressions: number; count: number }>()
      for (const r of rows ?? []) {
        if (!r.query) continue
        const existing = map.get(r.query) ?? { totalPos: 0, totalImpressions: 0, count: 0 }
        existing.totalPos += r.avg_position ?? 0
        existing.totalImpressions += r.impressions ?? 0
        existing.count++
        map.set(r.query, existing)
      }
      return new Map(
        Array.from(map.entries()).map(([kw, v]) => [
          kw,
          { avgPos: v.totalPos / v.count, totalImpressions: v.totalImpressions },
        ])
      )
    }

    const thisWeek = aggregate(thisWeekRes.data)
    const lastWeek = aggregate(lastWeekRes.data)

    // Detect drops
    for (const [kw, curr] of thisWeek) {
      const prev = lastWeek.get(kw)
      if (!prev) continue
      if (curr.totalImpressions < MIN_IMPRESSIONS_TO_ALERT) continue

      const drop = curr.avgPos - prev.avgPos
      if (drop >= POSITION_DROP_THRESHOLD) {
        alerts.push({
          app_id: appId,
          app_name: app.name as string,
          type: 'position_drop',
          keyword: kw,
          prev_position: Math.round(prev.avgPos * 10) / 10,
          curr_position: Math.round(curr.avgPos * 10) / 10,
          drop: Math.round(drop * 10) / 10,
          impressions: curr.totalImpressions,
        })
      }
    }
  }

  // Store alerts in audit log
  if (alerts.length > 0) {
    await admin.from('scp_audit_log').insert(
      alerts.map((a) => ({
        app_id: a.app_id,
        action: 'alert.position_drop',
        entity_type: 'keyword',
        entity_id: null,
        payload: a,
        performed_by: null,
      }))
    )
  }

  return NextResponse.json({
    apps_checked: (apps ?? []).length,
    alerts_generated: alerts.length,
    alerts: alerts.slice(0, 50),
    period: {
      this_week: { from: thisWeekStart.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) },
      last_week: { from: lastWeekStart.toISOString().slice(0, 10), to: thisWeekStart.toISOString().slice(0, 10) },
    },
  })
}
