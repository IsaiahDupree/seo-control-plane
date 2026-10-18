// Refresh board — lists articles queued, in-progress, or recently refreshed
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
  const statusFilter = searchParams.get('status') // queued | generating | delivered | skipped
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  let query = admin
    .from('scp_refresh_queue')
    .select('id, article_id, reason, decay_signals, priority_score, status, queued_at, completed_at')
    .eq('app_id', appId)
    .order('priority_score', { ascending: false })
    .limit(limit)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data: queue, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  // Enrich with article info
  const articleIds = (queue ?? []).map((q) => q.article_id as string).filter(Boolean)
  const { data: articles } = articleIds.length
    ? await admin
        .from('scp_articles')
        .select('id, slug, title, cluster_name, word_count, published_at, gsc_avg_position')
        .in('id', articleIds)
    : { data: [] }

  const artMap = new Map((articles ?? []).map((a) => [a.id as string, a]))

  const enriched = (queue ?? []).map((q) => {
    const art = artMap.get(q.article_id as string)
    return {
      queue_id: q.id,
      article_id: q.article_id,
      slug: (art?.slug as string | null) ?? null,
      title: (art?.title as string | null) ?? null,
      cluster_name: (art?.cluster_name as string | null) ?? null,
      word_count: (art?.word_count as number | null) ?? null,
      published_at: (art?.published_at as string | null) ?? null,
      avg_position: (art?.gsc_avg_position as number | null) ?? null,
      reason: q.reason,
      decay_signals: q.decay_signals,
      priority_score: q.priority_score,
      status: q.status,
      queued_at: q.queued_at,
      completed_at: q.completed_at ?? null,
    }
  })

  // Summary counts
  const statusCounts = (queue ?? []).reduce((acc: Record<string, number>, q) => {
    const s = q.status as string
    acc[s] = (acc[s] ?? 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    total: queue?.length ?? 0,
    status_counts: statusCounts,
    items: enriched,
  })
}
