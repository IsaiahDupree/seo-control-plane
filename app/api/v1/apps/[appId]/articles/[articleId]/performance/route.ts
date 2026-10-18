// Per-article performance data — daily GSC and analytics aggregates
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)

  const admin = createAdminClient()

  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, published_at, gsc_avg_position, gsc_clicks, gsc_impressions, gsc_ctr')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const { data: dailyPerf, error: perfErr } = await admin
    .from('scp_article_performance')
    .select('date, sessions, pageviews, avg_scroll_depth, reads_complete, cta_clicks, conversions, avg_position, impressions, clicks, ctr')
    .eq('article_id', articleId)
    .gte('date', since)
    .lte('date', until)
    .order('date', { ascending: true })

  if (perfErr) return jsonError(500, 'query_failed', perfErr.message)

  const rows = dailyPerf ?? []

  const totals = rows.reduce((acc, r) => ({
    sessions: acc.sessions + ((r.sessions as number) ?? 0),
    pageviews: acc.pageviews + ((r.pageviews as number) ?? 0),
    reads_complete: acc.reads_complete + ((r.reads_complete as number) ?? 0),
    cta_clicks: acc.cta_clicks + ((r.cta_clicks as number) ?? 0),
    conversions: acc.conversions + ((r.conversions as number) ?? 0),
    clicks: acc.clicks + ((r.clicks as number) ?? 0),
    impressions: acc.impressions + ((r.impressions as number) ?? 0),
  }), { sessions: 0, pageviews: 0, reads_complete: 0, cta_clicks: 0, conversions: 0, clicks: 0, impressions: 0 })

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    title: article.title,
    published_at: article.published_at,
    gsc_current: {
      avg_position: article.gsc_avg_position,
      clicks: article.gsc_clicks,
      impressions: article.gsc_impressions,
      ctr: article.gsc_ctr,
    },
    period: { since, until },
    totals,
    daily: rows.map((r) => ({
      date: r.date,
      sessions: r.sessions,
      pageviews: r.pageviews,
      avg_scroll_depth: r.avg_scroll_depth,
      reads_complete: r.reads_complete,
      cta_clicks: r.cta_clicks,
      conversions: r.conversions,
      avg_position: r.avg_position,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
    })),
  })
}
