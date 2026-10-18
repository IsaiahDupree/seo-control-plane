// Revenue attribution — correlate GSC/article data with revenue events
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 100)

  const admin = createAdminClient()

  // Pull revenue events
  const { data: revenueEvents, error: revErr } = await admin
    .from('scp_analytics_events')
    .select('article_id, event_name, payload, occurred_at')
    .eq('app_id', appId)
    .in('event_name', ['paid', 'trial_started', 'signup', 'install', 'demo_booked'])
    .gte('occurred_at', `${since}T00:00:00Z`)
    .lte('occurred_at', `${until}T23:59:59Z`)
    .limit(5000)

  if (revErr) return jsonError(500, 'query_failed', revErr.message)

  const artRevMap = new Map<string, { events: number; revenue_usd: number; event_types: Record<string, number> }>()

  for (const ev of revenueEvents ?? []) {
    const artId = (ev.article_id as string | null) ?? '_direct'
    if (!artRevMap.has(artId)) artRevMap.set(artId, { events: 0, revenue_usd: 0, event_types: {} })
    const entry = artRevMap.get(artId)!
    entry.events++
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    if (typeof payload.revenue_usd === 'number') entry.revenue_usd += payload.revenue_usd
    const et = ev.event_name as string
    entry.event_types[et] = (entry.event_types[et] ?? 0) + 1
  }

  const articleIds = [...artRevMap.keys()].filter((id) => id !== '_direct')
  const { data: articles } = articleIds.length
    ? await admin.from('scp_articles').select('id, slug, title, cluster_name, gsc_clicks').in('id', articleIds)
    : { data: [] }

  const artLookup = new Map(((articles ?? []) as { id: string; slug: string; title: string; cluster_name: string | null; gsc_clicks: number | null }[]).map((a) => [a.id, a]))

  const attributed = Array.from(artRevMap.entries())
    .sort(([, a], [, b]) => b.revenue_usd - a.revenue_usd || b.events - a.events)
    .slice(0, limit)
    .map(([id, data]) => {
      const art = id !== '_direct' ? artLookup.get(id) : null
      return {
        article_id: id === '_direct' ? null : id,
        slug: art?.slug ?? null,
        title: art?.title ?? null,
        cluster_name: art?.cluster_name ?? null,
        gsc_clicks: art?.gsc_clicks ?? null,
        attributed_events: data.events,
        event_types: data.event_types,
        attributed_revenue_usd: Math.round(data.revenue_usd * 100) / 100,
        revenue_per_click: art?.gsc_clicks && art.gsc_clicks > 0
          ? Math.round((data.revenue_usd / art.gsc_clicks) * 10000) / 10000
          : null,
      }
    })

  const totals = {
    total_events: attributed.reduce((s, a) => s + a.attributed_events, 0),
    total_revenue_usd: Math.round(attributed.reduce((s, a) => s + a.attributed_revenue_usd, 0) * 100) / 100,
    articles_contributing: attributed.filter((a) => a.article_id !== null).length,
  }

  return NextResponse.json({ period: { since, until }, totals, attributed })
}
