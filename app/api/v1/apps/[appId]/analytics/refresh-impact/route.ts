// Refresh impact — measure GSC position changes after article refreshes
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
  const days = Math.min(parseInt(searchParams.get('days') ?? '90', 10), 365)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 100)

  const admin = createAdminClient()

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // Fetch completed refresh queue items
  const { data: refreshed, error: refErr } = await admin
    .from('scp_refresh_queue')
    .select('article_id, queued_at, completed_at, status')
    .eq('app_id', appId)
    .eq('status', 'delivered')
    .gte('queued_at', cutoff)
    .order('completed_at', { ascending: false })
    .limit(limit)

  if (refErr) return jsonError(500, 'query_failed', refErr.message)

  const articleIds = [...new Set((refreshed ?? []).map((r) => r.article_id as string))]

  const { data: articles } = articleIds.length
    ? await admin
        .from('scp_articles')
        .select('id, slug, title, gsc_avg_position, gsc_clicks, updated_at')
        .in('id', articleIds)
    : { data: [] }

  const artLookup = new Map(
    ((articles ?? []) as { id: string; slug: string; title: string; gsc_avg_position: number | null; gsc_clicks: number | null }[]).map((a) => [a.id, a])
  )

  const results = (refreshed ?? []).map((r) => {
    const art = artLookup.get(r.article_id as string)
    return {
      article_id: r.article_id,
      slug: art?.slug ?? null,
      title: art?.title ?? null,
      queued_at: r.queued_at,
      completed_at: r.completed_at,
      current_position: art?.gsc_avg_position ?? null,
      current_clicks: art?.gsc_clicks ?? null,
    }
  })

  return NextResponse.json({
    period_days: days,
    refreshes_analyzed: results.length,
    results,
    note: 'Compare current_position against historical data for before/after impact analysis',
  })
}
