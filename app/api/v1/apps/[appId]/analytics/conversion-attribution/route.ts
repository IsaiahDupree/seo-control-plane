// Revenue / conversion attribution analytics
// Rolls up conversion events from scp_analytics_events and links them to articles.
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
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  // Pull conversion events tied to articles
  const { data: events, error } = await admin
    .from('scp_analytics_events')
    .select('article_id, event_name, payload, occurred_at')
    .eq('app_id', appId)
    .in('event_name', ['signup', 'trial_started', 'paid', 'install', 'demo_booked', 'conversion', 'cta_clicked'])
    .gte('occurred_at', `${since}T00:00:00Z`)
    .lte('occurred_at', `${until}T23:59:59Z`)
    .order('occurred_at', { ascending: false })
    .limit(5000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Group by article_id
  const articleMap = new Map<string, {
    article_id: string
    event_counts: Record<string, number>
    total_conversions: number
    estimated_revenue_usd: number
  }>()

  for (const ev of events ?? []) {
    const artId = (ev.article_id as string | null) ?? '_unattributed'
    if (!articleMap.has(artId)) {
      articleMap.set(artId, { article_id: artId, event_counts: {}, total_conversions: 0, estimated_revenue_usd: 0 })
    }
    const entry = articleMap.get(artId)!
    const eName = ev.event_name as string
    entry.event_counts[eName] = (entry.event_counts[eName] ?? 0) + 1
    entry.total_conversions++

    // Sum revenue if present in payload
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    if (typeof payload.revenue_usd === 'number') {
      entry.estimated_revenue_usd += payload.revenue_usd
    }
  }

  // Fetch article titles for enrichment
  const articleIds = [...articleMap.keys()].filter((id) => id !== '_unattributed')
  const { data: articles } = articleIds.length
    ? await admin
        .from('scp_articles')
        .select('id, slug, title, cluster_name, focus_keyword')
        .in('id', articleIds)
    : { data: [] }

  const artLookup = new Map((articles ?? []).map((a) => [a.id, a]))

  const attributed = Array.from(articleMap.values())
    .sort((a, b) => b.total_conversions - a.total_conversions)
    .slice(0, limit)
    .map((entry) => {
      const art = artLookup.get(entry.article_id)
      return {
        article_id: entry.article_id === '_unattributed' ? null : entry.article_id,
        slug: (art?.slug as string | null) ?? null,
        title: (art?.title as string | null) ?? null,
        cluster_name: (art?.cluster_name as string | null) ?? null,
        focus_keyword: (art?.focus_keyword as string | null) ?? null,
        total_conversions: entry.total_conversions,
        event_counts: entry.event_counts,
        estimated_revenue_usd: Math.round(entry.estimated_revenue_usd * 100) / 100,
      }
    })

  const totals = {
    total_conversions: attributed.reduce((s, a) => s + a.total_conversions, 0),
    total_estimated_revenue_usd: Math.round(attributed.reduce((s, a) => s + a.estimated_revenue_usd, 0) * 100) / 100,
    articles_with_conversions: attributed.filter((a) => a.article_id !== null).length,
  }

  return NextResponse.json({
    period: { since, until },
    totals,
    attributed,
  })
}
