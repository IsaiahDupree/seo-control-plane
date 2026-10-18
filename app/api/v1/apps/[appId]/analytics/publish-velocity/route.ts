// Publish velocity — articles published per day/week/month over time
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
  const since = searchParams.get('since') ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)
  const granularity = searchParams.get('granularity') ?? 'week' // day | week | month

  const admin = createAdminClient()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, published_at, cluster_name, word_count')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .gte('published_at', `${since}T00:00:00Z`)
    .lte('published_at', `${until}T23:59:59Z`)
    .order('published_at', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)

  const bucketKey = (dateStr: string): string => {
    const d = new Date(dateStr)
    if (granularity === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (granularity === 'week') {
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(d.setDate(diff))
      return monday.toISOString().slice(0, 10)
    }
    return dateStr.slice(0, 10)
  }

  const buckets = new Map<string, { count: number; words: number; clusters: Set<string> }>()
  for (const a of articles ?? []) {
    const key = bucketKey(a.published_at as string)
    if (!buckets.has(key)) buckets.set(key, { count: 0, words: 0, clusters: new Set() })
    const b = buckets.get(key)!
    b.count++
    b.words += (a.word_count as number) ?? 0
    if (a.cluster_name) b.clusters.add(a.cluster_name as string)
  }

  const periods = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, b]) => ({
      period,
      articles_published: b.count,
      total_words: b.words,
      unique_clusters: b.clusters.size,
    }))

  const total = periods.reduce((s, p) => s + p.articles_published, 0)
  const avgPerPeriod = periods.length > 0 ? Math.round((total / periods.length) * 10) / 10 : 0

  return NextResponse.json({
    period: { since, until, granularity },
    total_published: total,
    avg_per_period: avgPerPeriod,
    velocity: periods,
  })
}
