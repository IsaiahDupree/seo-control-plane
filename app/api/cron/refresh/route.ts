import { NextRequest, NextResponse } from 'next/server'
import { cronBearerOk } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase'
import { enqueueStaleArticles, processNextRefreshItem } from '@/lib/refresh-queue'

/** Vercel Cron: daily stale-article detection + refresh processing.
 *  When `SCP_CRON_SECRET` or `CRON_SECRET` is set, require `Authorization: Bearer …`.
 */
export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: apps } = await db
    .from('scp_apps')
    .select('id, slug')
    .eq('status', 'active')

  if (!apps || apps.length === 0) {
    return NextResponse.json({ ok: true, message: 'No active apps' })
  }

  const results: {
    app: string
    enqueued: number
    skipped: number
    processed: { slug: string; success: boolean; error?: string } | null
  }[] = []

  for (const app of apps) {
    // 1. Detect stale articles and enqueue them
    const { enqueued, skipped } = await enqueueStaleArticles(app.id as string)

    // 2. Process one refresh item per app per cron run (rate-limited)
    const processed = await processNextRefreshItem(app.id as string)

    results.push({
      app: app.slug as string,
      enqueued,
      skipped,
      processed: processed
        ? { slug: processed.slug, success: processed.success, error: processed.error }
        : null,
    })
  }

  return NextResponse.json({ ok: true, ran_at: new Date().toISOString(), results })
}
