// Freshness distribution — article age buckets showing content staleness
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
  const cluster = searchParams.get('cluster')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, slug, published_at, updated_at, cluster_name, gsc_avg_position, status')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .not('published_at', 'is', null)

  if (cluster) query = query.eq('cluster_name', cluster)

  const { data: articles, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const now = Date.now()

  const BUCKETS = [
    { label: '< 30 days', max_days: 30 },
    { label: '30-90 days', max_days: 90 },
    { label: '91-180 days', max_days: 180 },
    { label: '181-365 days', max_days: 365 },
    { label: '> 365 days', max_days: Infinity },
  ]

  const enriched = (articles ?? []).map((a) => {
    const pubDate = new Date(a.published_at as string).getTime()
    const updDate = a.updated_at ? new Date(a.updated_at as string).getTime() : pubDate
    const ageDays = Math.floor((now - pubDate) / (1000 * 60 * 60 * 24))
    const daysSinceUpdate = Math.floor((now - updDate) / (1000 * 60 * 60 * 24))
    return { ...a, age_days: ageDays, days_since_update: daysSinceUpdate }
  })

  const distribution = BUCKETS.map((b, i) => {
    const min = i === 0 ? 0 : BUCKETS[i - 1].max_days
    const matching = enriched.filter((a) => a.age_days >= min && a.age_days <= b.max_days)
    const avgPos = matching.length > 0
      ? Math.round(matching.reduce((s, a) => s + ((a.gsc_avg_position as number) ?? 50), 0) / matching.length * 10) / 10
      : null
    const stale = matching.filter((a) => a.days_since_update > 180).length
    return { age_range: b.label, count: matching.length, avg_position: avgPos, stale_count: stale }
  })

  const needsRefresh = enriched
    .filter((a) => a.age_days > 180 && a.days_since_update > 180)
    .sort((a, b) => (a.gsc_avg_position as number ?? 100) - (b.gsc_avg_position as number ?? 100))
    .slice(0, 20)
    .map((a) => ({
      article_id: a.id,
      slug: a.slug,
      cluster_name: a.cluster_name ?? null,
      age_days: a.age_days,
      days_since_update: a.days_since_update,
      gsc_avg_position: a.gsc_avg_position ?? null,
    }))

  return NextResponse.json({
    cluster_filter: cluster ?? null,
    total_articles: enriched.length,
    distribution,
    needs_refresh: needsRefresh,
    avg_age_days: enriched.length > 0 ? Math.round(enriched.reduce((s, a) => s + a.age_days, 0) / enriched.length) : null,
  })
}
