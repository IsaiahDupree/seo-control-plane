// Assisted conversion paths — articles that contributed to conversions but weren't the last touch
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

  // Pull assisted conversion events
  const { data: events, error } = await admin
    .from('scp_analytics_events')
    .select('article_id, event_name, payload, occurred_at')
    .eq('app_id', appId)
    .eq('event_name', 'assisted_conversion')
    .gte('occurred_at', `${since}T00:00:00Z`)
    .lte('occurred_at', `${until}T23:59:59Z`)
    .limit(5000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Group by article
  const artMap = new Map<string, { count: number; conversion_types: Record<string, number>; revenue: number }>()
  for (const ev of events ?? []) {
    const artId = (ev.article_id as string | null) ?? '_unattributed'
    if (!artMap.has(artId)) artMap.set(artId, { count: 0, conversion_types: {}, revenue: 0 })
    const entry = artMap.get(artId)!
    entry.count++
    const payload = (ev.payload ?? {}) as Record<string, unknown>
    const ct = (payload.conversion_type as string | null) ?? 'unknown'
    entry.conversion_types[ct] = (entry.conversion_types[ct] ?? 0) + 1
    if (typeof payload.revenue_usd === 'number') entry.revenue += payload.revenue_usd
  }

  const articleIds = [...artMap.keys()].filter((id) => id !== '_unattributed')
  const { data: articles } = articleIds.length
    ? await admin.from('scp_articles').select('id, slug, title, cluster_name').in('id', articleIds)
    : { data: [] }

  const artLookup = new Map(((articles ?? []) as { id: string; slug: string; title: string; cluster_name: string | null }[]).map((a) => [a.id, a]))

  const results = Array.from(artMap.entries())
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, limit)
    .map(([id, data]) => {
      const art = artLookup.get(id)
      return {
        article_id: id === '_unattributed' ? null : id,
        slug: art?.slug ?? null,
        title: art?.title ?? null,
        cluster_name: art?.cluster_name ?? null,
        assisted_conversions: data.count,
        conversion_types: data.conversion_types,
        assisted_revenue_usd: Math.round(data.revenue * 100) / 100,
      }
    })

  return NextResponse.json({
    period: { since, until },
    total_assisted_conversions: results.reduce((s, r) => s + r.assisted_conversions, 0),
    articles: results,
  })
}
