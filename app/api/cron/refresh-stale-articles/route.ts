// Cron: Auto-queue stale articles for refresh based on freshness scoring
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

const FRESHNESS_THRESHOLD_DAYS = 180  // articles older than 6 months
const MAX_QUEUE_PER_RUN = 50          // cap per cron run to avoid thundering herd

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - FRESHNESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Find published articles older than threshold, not already queued for refresh
  const { data: articles, error: artErr } = await admin
    .from('scp_articles')
    .select('id, app_id, slug, gsc_avg_position, published_at')
    .in('status', ['published', 'indexed', 'ranked'])
    .lt('published_at', cutoff)
    .order('published_at', { ascending: true }) // oldest first
    .limit(MAX_QUEUE_PER_RUN * 2) // over-fetch to filter already-queued

  if (artErr) return NextResponse.json({ error: artErr.message }, { status: 500 })

  if (!articles?.length) {
    return NextResponse.json({ queued: 0, message: 'No stale articles found' })
  }

  // Get already-queued article IDs
  const { data: alreadyQueued } = await admin
    .from('scp_refresh_queue')
    .select('article_id')
    .eq('status', 'queued')
    .in('article_id', articles.map((a) => a.id))

  const queuedSet = new Set((alreadyQueued ?? []).map((r) => r.article_id))

  const toQueue = articles
    .filter((a) => !queuedSet.has(a.id))
    .slice(0, MAX_QUEUE_PER_RUN)

  if (toQueue.length === 0) {
    return NextResponse.json({ queued: 0, message: 'All stale articles already in refresh queue' })
  }

  const now = new Date().toISOString()

  const rows = toQueue.map((a) => {
    const ageDays = Math.round((Date.now() - new Date(a.published_at as string).getTime()) / (1000 * 60 * 60 * 24))
    // Priority score: older + poor ranking = higher priority
    const rankPenalty = a.gsc_avg_position !== null && (a.gsc_avg_position as number) > 10 ? 20 : 0
    const agePriority = Math.min(80, Math.round((ageDays - FRESHNESS_THRESHOLD_DAYS) / 10))
    const priorityScore = agePriority + rankPenalty

    return {
      app_id: a.app_id,
      article_id: a.id,
      status: 'queued',
      priority_score: priorityScore,
      reason: 'cron_stale_detection',
      created_at: now,
    }
  })

  const { data: inserted, error: insertErr } = await admin
    .from('scp_refresh_queue')
    .insert(rows)
    .select('id')

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({
    queued: inserted?.length ?? 0,
    total_stale_found: articles.length,
    already_in_queue: queuedSet.size,
    cutoff_date: cutoff.slice(0, 10),
  })
}
