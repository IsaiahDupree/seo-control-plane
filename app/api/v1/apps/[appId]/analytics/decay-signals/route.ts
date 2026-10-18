// Decay signals analytics — identifies articles showing ranking decay
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
  const positionThreshold = parseFloat(searchParams.get('position_threshold') ?? '20')
  const minAgedays = parseInt(searchParams.get('min_age_days') ?? '60', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  const cutoff = new Date(Date.now() - minAgedays * 24 * 60 * 60 * 1000).toISOString()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, cluster_name, focus_keyword, published_at, gsc_avg_position, gsc_clicks, gsc_impressions, word_count')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .lt('published_at', cutoff)
    .order('gsc_avg_position', { ascending: false, nullsFirst: false })
    .limit(2000)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Compute decay score per article
  const decaying = (articles ?? [])
    .map((a) => {
      const pos = (a.gsc_avg_position as number | null)
      const clicks = (a.gsc_clicks as number | null) ?? 0
      const impressions = (a.gsc_impressions as number | null) ?? 0
      const publishedDaysAgo = a.published_at
        ? Math.round((Date.now() - new Date(a.published_at as string).getTime()) / (1000 * 60 * 60 * 24))
        : null

      const signals: string[] = []
      let decayScore = 0

      if (pos !== null && pos > positionThreshold) {
        signals.push(`GSC position ${Math.round(pos)} (above ${positionThreshold} threshold)`)
        decayScore += Math.min(40, pos - positionThreshold)
      }
      if (impressions === 0) {
        signals.push('Zero GSC impressions')
        decayScore += 30
      } else if (clicks === 0 && impressions > 0) {
        signals.push('Impressions but zero clicks (low CTR)')
        decayScore += 15
      }
      if (publishedDaysAgo !== null && publishedDaysAgo > 365) {
        signals.push(`Published ${publishedDaysAgo} days ago — content age risk`)
        decayScore += 10
      }
      const wc = (a.word_count as number | null) ?? 0
      if (wc > 0 && wc < 600) {
        signals.push(`Thin content (${wc} words)`)
        decayScore += 15
      }

      return {
        article_id: a.id,
        slug: a.slug,
        title: a.title,
        cluster_name: (a.cluster_name as string | null) ?? null,
        focus_keyword: (a.focus_keyword as string | null) ?? null,
        published_at: a.published_at,
        published_days_ago: publishedDaysAgo,
        gsc_avg_position: pos,
        gsc_clicks: clicks,
        gsc_impressions: impressions,
        word_count: wc || null,
        decay_score: Math.min(100, Math.round(decayScore)),
        decay_signals: signals,
      }
    })
    .filter((a) => a.decay_score > 0)
    .sort((a, b) => b.decay_score - a.decay_score)
    .slice(0, limit)

  return NextResponse.json({
    total_decaying: decaying.length,
    articles: decaying,
    analysed_at: new Date().toISOString(),
  })
}
