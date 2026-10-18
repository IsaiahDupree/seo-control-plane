// F-CP-059: Article word count distribution analytics
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

const BUCKETS = [
  { label: '0-500', min: 0, max: 500 },
  { label: '501-1000', min: 501, max: 1000 },
  { label: '1001-1500', min: 1001, max: 1500 },
  { label: '1501-2000', min: 1501, max: 2000 },
  { label: '2001-3000', min: 2001, max: 3000 },
  { label: '3001-5000', min: 3001, max: 5000 },
  { label: '5001+', min: 5001, max: Infinity },
]

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const statusFilter = searchParams.get('status')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, status, cluster_name, body_mdx')
    .eq('app_id', appId)

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  } else {
    query = query.not('status', 'eq', 'archived')
  }

  const { data: articles, error } = await query.limit(5000)
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = articles ?? []

  // Compute word counts
  const withCounts = rows.map((a) => ({
    id: a.id,
    status: a.status as string,
    cluster_name: (a.cluster_name as string | null) ?? 'Unclustered',
    word_count: countWords((a.body_mdx as string) ?? ''),
  }))

  // Bucket distribution
  const distribution = BUCKETS.map((b) => {
    const matches = withCounts.filter((a) => a.word_count >= b.min && a.word_count <= b.max)
    return {
      bucket: b.label,
      count: matches.length,
      pct: rows.length > 0 ? Math.round((matches.length / rows.length) * 100) : 0,
    }
  })

  const allCounts = withCounts.map((a) => a.word_count)
  const totalWords = allCounts.reduce((s, n) => s + n, 0)
  const avgWordCount = rows.length > 0 ? Math.round(totalWords / rows.length) : 0
  const sorted = [...allCounts].sort((a, b) => a - b)
  const medianWordCount = sorted.length > 0
    ? sorted.length % 2 === 0
      ? Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
      : sorted[Math.floor(sorted.length / 2)]
    : 0

  // Per cluster breakdown
  const clusterMap = new Map<string, number[]>()
  for (const a of withCounts) {
    if (!clusterMap.has(a.cluster_name)) clusterMap.set(a.cluster_name, [])
    clusterMap.get(a.cluster_name)!.push(a.word_count)
  }

  const by_cluster = Array.from(clusterMap.entries()).map(([name, counts]) => ({
    cluster_name: name,
    article_count: counts.length,
    avg_word_count: Math.round(counts.reduce((s, n) => s + n, 0) / counts.length),
    min_word_count: Math.min(...counts),
    max_word_count: Math.max(...counts),
  })).sort((a, b) => b.avg_word_count - a.avg_word_count)

  return NextResponse.json({
    total_articles: rows.length,
    avg_word_count: avgWordCount,
    median_word_count: medianWordCount,
    min_word_count: sorted[0] ?? 0,
    max_word_count: sorted[sorted.length - 1] ?? 0,
    distribution,
    by_cluster,
    analysed_at: new Date().toISOString(),
  })
}
