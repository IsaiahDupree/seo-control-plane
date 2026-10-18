// F-CP-077: Indexing status checker
// Checks whether an article URL appears in GSC performance data (proxy for indexed status).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const [articleResult, appResult] = await Promise.all([
    admin
      .from('scp_articles')
      .select('id, slug, title, status, published_at, canonical_url')
      .eq('id', articleId)
      .eq('app_id', appId)
      .maybeSingle(),
    admin
      .from('scp_apps')
      .select('base_url, domain')
      .eq('id', appId)
      .maybeSingle(),
  ])

  if (articleResult.error) return jsonError(500, 'query_failed', articleResult.error.message)
  if (!articleResult.data) return jsonError(404, 'not_found', 'Article not found')

  const article = articleResult.data
  const app = appResult.data

  const baseUrl = app
    ? ((app.base_url ?? `https://${app.domain ?? 'example.com'}`)).replace(/\/$/, '')
    : ''

  const canonicalUrl =
    (article.canonical_url as string | null) ??
    (baseUrl ? `${baseUrl}/blog/${article.slug}` : null)

  // Check GSC performance table for impressions on this URL (indicates Google saw it)
  const { data: gscData } = await admin
    .from('scp_gsc_performance')
    .select('page_url, avg_position, impressions, clicks, date')
    .eq('app_id', appId)
    .eq('page_url', canonicalUrl ?? '')
    .order('date', { ascending: false })
    .limit(30)

  const hasGscData = (gscData ?? []).length > 0
  const totalImpressions = (gscData ?? []).reduce((s, r) => s + (r.impressions ?? 0), 0)
  const latestGscDate = gscData?.[0]?.date ?? null
  const avgPosition = hasGscData
    ? Math.round(((gscData ?? []).reduce((s, r) => s + (r.avg_position ?? 0), 0) / (gscData ?? []).length) * 10) / 10
    : null

  // Determine indexing status
  const currentStatus = article.status as string
  let indexingStatus: 'indexed' | 'likely_indexed' | 'not_indexed' | 'unknown'

  if (currentStatus === 'indexed' || currentStatus === 'ranked') {
    indexingStatus = 'indexed'
  } else if (hasGscData && totalImpressions > 0) {
    indexingStatus = 'likely_indexed'
  } else if (!article.published_at) {
    indexingStatus = 'not_indexed'
  } else {
    const ageHours = (Date.now() - new Date(article.published_at as string).getTime()) / (1000 * 60 * 60)
    indexingStatus = ageHours > 72 ? 'unknown' : 'not_indexed'
  }

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    canonical_url: canonicalUrl,
    indexing: {
      status: indexingStatus,
      article_status: currentStatus,
      gsc_has_data: hasGscData,
      total_impressions: totalImpressions,
      avg_position: avgPosition,
      latest_gsc_date: latestGscDate,
    },
    recommendations: [
      ...(indexingStatus === 'not_indexed' && article.published_at
        ? ['Submit URL to Google Search Console for manual indexing request']
        : []),
      ...(indexingStatus === 'unknown'
        ? ['Check Google Search Console manually — article is old but has no GSC data']
        : []),
      ...(hasGscData && avgPosition !== null && avgPosition > 20
        ? ['Article is indexed but ranking below position 20 — consider a content refresh']
        : []),
    ],
    checked_at: new Date().toISOString(),
  })
}
