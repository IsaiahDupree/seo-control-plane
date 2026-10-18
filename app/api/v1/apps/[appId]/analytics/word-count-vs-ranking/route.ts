// Word count vs ranking correlation — scatter data for content length analysis
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
  const intentType = searchParams.get('intent_type')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, slug, cluster_name, intent_type, word_count, gsc_avg_position, gsc_clicks, published_at')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .not('word_count', 'is', null)
    .not('gsc_avg_position', 'is', null)
    .order('gsc_avg_position', { ascending: true, nullsFirst: false })
    .limit(1000)

  if (cluster) query = query.eq('cluster_name', cluster)
  if (intentType) query = query.eq('intent_type', intentType)

  const { data: articles, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = articles ?? []

  // Bucket by word count ranges
  const BUCKETS = [
    { label: '< 500', min: 0, max: 499 },
    { label: '500-999', min: 500, max: 999 },
    { label: '1000-1499', min: 1000, max: 1499 },
    { label: '1500-1999', min: 1500, max: 1999 },
    { label: '2000-2999', min: 2000, max: 2999 },
    { label: '3000+', min: 3000, max: Infinity },
  ]

  const bucketStats = BUCKETS.map((b) => {
    const matching = rows.filter((a) => {
      const wc = (a.word_count as number)
      return wc >= b.min && wc <= b.max
    })
    const positions = matching.map((a) => a.gsc_avg_position as number)
    const avgPos = positions.length > 0
      ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10
      : null
    const totalClicks = matching.reduce((s, a) => s + ((a.gsc_clicks as number) ?? 0), 0)
    return { word_count_range: b.label, article_count: matching.length, avg_position: avgPos, total_clicks: totalClicks }
  })

  const scatter = rows.map((a) => ({
    article_id: a.id,
    slug: a.slug,
    cluster_name: a.cluster_name ?? null,
    intent_type: a.intent_type ?? null,
    word_count: a.word_count,
    avg_position: a.gsc_avg_position,
    clicks: a.gsc_clicks ?? 0,
  }))

  // Pearson correlation between word count and position
  const n = scatter.length
  let corrNote = 'Insufficient data'
  if (n >= 5) {
    const wcs = scatter.map((s) => s.word_count as number)
    const pos = scatter.map((s) => s.avg_position as number)
    const meanWc = wcs.reduce((s, v) => s + v, 0) / n
    const meanPos = pos.reduce((s, v) => s + v, 0) / n
    const num = wcs.reduce((s, v, i) => s + (v - meanWc) * (pos[i] - meanPos), 0)
    const denA = Math.sqrt(wcs.reduce((s, v) => s + (v - meanWc) ** 2, 0))
    const denB = Math.sqrt(pos.reduce((s, v) => s + (v - meanPos) ** 2, 0))
    const r = denA * denB > 0 ? Math.round((num / (denA * denB)) * 100) / 100 : 0
    corrNote = r < -0.2 ? `Negative correlation (r=${r}): longer articles tend to rank better` : r > 0.2 ? `Positive correlation (r=${r}): shorter articles tend to rank better in this app` : `Weak correlation (r=${r}): word count may not be a strong ranking factor here`
  }

  return NextResponse.json({
    cluster_filter: cluster ?? null,
    intent_filter: intentType ?? null,
    articles_analyzed: n,
    bucket_summary: bucketStats,
    scatter,
    correlation_note: corrNote,
  })
}
