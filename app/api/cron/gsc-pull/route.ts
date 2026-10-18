import { NextRequest, NextResponse } from 'next/server'
import { cronBearerOk } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase'

/**
 * Vercel Cron: weekly GSC performance pull.
 * For each active app with a configured GSC property, fetches the last 7 days
 * of query-level data; upserts keyword rows and `scp_gsc_performance` (when migrated).
 *
 * Requires per-app GSC credentials stored in scp_apps.context:
 *   { gsc_property_url, gsc_access_token }
 *
 * Schedule: 0 4 * * 1 (Mondays at 4 AM UTC)
 */
export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: apps } = await db
    .from('scp_apps')
    .select('id, slug, context, base_url')
    .eq('status', 'active')

  if (!apps || apps.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active apps' })
  }

  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - 7 * 86_400_000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)

  const results: { app: string; rows_upserted: number; error?: string }[] = []

  for (const app of apps) {
    const ctx = (app.context as Record<string, unknown>) ?? {}
    const propertyUrl = ctx.gsc_property_url as string | undefined
    const accessToken = ctx.gsc_access_token as string | undefined

    if (!propertyUrl || !accessToken) {
      results.push({ app: app.slug as string, rows_upserted: 0, error: 'no_gsc_config' })
      continue
    }

    try {
      const res = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            dimensions: ['query', 'page'],
            rowLimit: 5000,
          }),
          signal: AbortSignal.timeout(30_000),
        }
      )

      if (!res.ok) {
        results.push({ app: app.slug as string, rows_upserted: 0, error: `GSC HTTP ${res.status}` })
        continue
      }

      const json = await res.json() as {
        rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[]
      }
      const rows = json.rows ?? []

      // Upsert into scp_keywords (updates search metrics) via gsc-sync endpoint path
      const keywordRows = rows.map((r) => ({
        app_id: app.id,
        keyword: r.keys[0]?.trim().toLowerCase() ?? '',
        last_refreshed_at: new Date().toISOString(),
      })).filter((r) => r.keyword)

      if (keywordRows.length > 0) {
        await db
          .from('scp_keywords')
          .upsert(keywordRows, { onConflict: 'app_id,keyword', ignoreDuplicates: true })
      }

      // Upsert daily performance rows per page-query pair
      const baseUrl = (app.base_url as string) ?? ''
      const perfRows = rows.map((r) => {
        const page = r.keys[1] ?? ''
        const slug = page.replace(baseUrl, '').replace(/^\/blog\//, '').replace(/\/$/, '')
        return {
          app_id: app.id as string,
          slug,
          page_url: page,
          query: r.keys[0],
          date: fmt(endDate),
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          avg_position: r.position,
        }
      })

      if (perfRows.length > 0) {
        try {
          await db
            .from('scp_gsc_performance')
            .upsert(perfRows, { onConflict: 'app_id,query,date', ignoreDuplicates: false })
        } catch { /* table optional in current migration */ }
      }

      results.push({ app: app.slug as string, rows_upserted: rows.length })
    } catch (err) {
      results.push({
        app: app.slug as string,
        rows_upserted: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), results })
}
