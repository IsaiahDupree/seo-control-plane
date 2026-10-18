// Top performing articles by clicks, conversions, or position
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
  const sortBy = searchParams.get('sort_by') ?? 'clicks' // clicks | position | impressions
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const cluster = searchParams.get('cluster')

  const admin = createAdminClient()

  let query = admin
    .from('scp_articles')
    .select('id, slug, title, cluster_name, focus_keyword, published_at, gsc_clicks, gsc_impressions, gsc_avg_position, gsc_ctr, word_count, qa_score')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .limit(limit)

  if (cluster) query = query.eq('cluster_name', cluster)

  if (sortBy === 'position') {
    query = query.order('gsc_avg_position', { ascending: true, nullsFirst: false })
  } else if (sortBy === 'impressions') {
    query = query.order('gsc_impressions', { ascending: false, nullsFirst: false })
  } else {
    query = query.order('gsc_clicks', { ascending: false, nullsFirst: false })
  }

  const { data: articles, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({
    sort_by: sortBy,
    cluster_filter: cluster ?? null,
    total: articles?.length ?? 0,
    articles: (articles ?? []).map((a) => ({
      article_id: a.id,
      slug: a.slug,
      title: a.title,
      cluster_name: a.cluster_name ?? null,
      focus_keyword: a.focus_keyword ?? null,
      published_at: a.published_at,
      gsc_clicks: a.gsc_clicks ?? 0,
      gsc_impressions: a.gsc_impressions ?? 0,
      gsc_avg_position: a.gsc_avg_position ?? null,
      gsc_ctr: a.gsc_ctr ?? null,
      word_count: a.word_count ?? null,
      qa_score: a.qa_score ?? null,
    })),
  })
}
