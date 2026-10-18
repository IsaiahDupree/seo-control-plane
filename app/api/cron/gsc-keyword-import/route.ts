// F-CP-043: GSC keyword auto-import — promotes high-impression GSC queries into scp_keywords
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

const MIN_IMPRESSIONS = 50
const MIN_CLICKS = 0
const MAX_POSITION_FILTER = 50
const BATCH_LIMIT = 10000

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Fetch all apps that have GSC performance data
  const { data: apps, error: appsErr } = await admin
    .from('scp_apps')
    .select('id')
    .eq('status', 'active')

  if (appsErr) return NextResponse.json({ error: appsErr.message }, { status: 500 })

  let totalImported = 0
  let totalSkipped = 0
  const appResults: Array<{ app_id: string; imported: number; skipped: number }> = []

  for (const app of apps ?? []) {
    const appId = app.id

    // Pull top GSC queries that have enough signal
    const { data: gscRows, error: gscErr } = await admin
      .from('scp_gsc_performance')
      .select('query, avg_position, impressions, clicks, ctr, date')
      .eq('app_id', appId)
      .gte('impressions', MIN_IMPRESSIONS)
      .gte('clicks', MIN_CLICKS)
      .lte('avg_position', MAX_POSITION_FILTER)
      .order('impressions', { ascending: false })
      .limit(BATCH_LIMIT)

    if (gscErr || !gscRows?.length) continue

    // Fetch existing keywords for this app to skip already-known ones
    const { data: existingKws } = await admin
      .from('scp_keywords')
      .select('keyword')
      .eq('app_id', appId)

    const existingSet = new Set((existingKws ?? []).map((k) => k.keyword.toLowerCase().trim()))

    const now = new Date().toISOString()
    const toInsert = gscRows
      .filter((row) => row.query && !existingSet.has(row.query.toLowerCase().trim()))
      .map((row) => ({
        app_id: appId,
        keyword: row.query!.toLowerCase().trim(),
        source: 'gsc_auto_import',
        status: 'active',
        is_seed: false,
        created_at: now,
        updated_at: now,
      }))

    totalSkipped += gscRows.length - toInsert.length

    if (toInsert.length === 0) {
      appResults.push({ app_id: appId, imported: 0, skipped: gscRows.length })
      continue
    }

    // Upsert in batches of 500
    let appImported = 0
    for (let i = 0; i < toInsert.length; i += 500) {
      const batch = toInsert.slice(i, i + 500)
      const { error } = await admin
        .from('scp_keywords')
        .upsert(batch, { onConflict: 'app_id,keyword', ignoreDuplicates: true })
      if (!error) appImported += batch.length
    }

    totalImported += appImported
    appResults.push({ app_id: appId, imported: appImported, skipped: gscRows.length - appImported })
  }

  return NextResponse.json({
    apps_processed: (apps ?? []).length,
    total_imported: totalImported,
    total_skipped: totalSkipped,
    per_app: appResults,
  })
}
