// Crawl health analytics — surfaces articles with potential indexing or crawl issues
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, published_at, canonical_url, focus_keyword, word_count, gsc_impressions, gsc_avg_position')
    .eq('app_id', appId)
    .not('status', 'eq', 'archived')
    .order('published_at', { ascending: false })
    .limit(2000)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = articles ?? []
  const now = Date.now()

  const issues: Array<{
    article_id: string
    slug: string
    title: string
    issue_type: string
    severity: 'critical' | 'warning' | 'info'
    detail: string
  }> = []

  for (const a of rows) {
    const publishedAt = a.published_at ? new Date(a.published_at as string).getTime() : null
    const ageHours = publishedAt ? (now - publishedAt) / (1000 * 60 * 60) : null
    const ageStr = ageHours !== null ? `${Math.round(ageHours / 24)}d` : 'unknown'

    // Published but no GSC impressions after 7 days
    if (
      ['published', 'indexed', 'ranked'].includes(a.status as string) &&
      ageHours !== null && ageHours > 168 &&
      ((a.gsc_impressions as number | null) ?? 0) === 0
    ) {
      issues.push({
        article_id: a.id,
        slug: a.slug as string,
        title: a.title as string,
        issue_type: 'no_gsc_impressions',
        severity: 'critical',
        detail: `Published ${ageStr} ago with 0 GSC impressions — likely not indexed`,
      })
    }

    // Very low word count
    const wc = (a.word_count as number | null) ?? 0
    if (wc > 0 && wc < 300) {
      issues.push({
        article_id: a.id,
        slug: a.slug as string,
        title: a.title as string,
        issue_type: 'thin_content',
        severity: 'critical',
        detail: `Only ${wc} words — Google may classify as thin content`,
      })
    }

    // Missing focus keyword
    if (!a.focus_keyword) {
      issues.push({
        article_id: a.id,
        slug: a.slug as string,
        title: a.title as string,
        issue_type: 'no_focus_keyword',
        severity: 'warning',
        detail: 'No focus keyword set — SEO scoring is limited',
      })
    }

    // Ranking very low (position > 50)
    const pos = a.gsc_avg_position as number | null
    if (pos !== null && pos > 50 && ageHours !== null && ageHours > 720) {
      issues.push({
        article_id: a.id,
        slug: a.slug as string,
        title: a.title as string,
        issue_type: 'very_low_ranking',
        severity: 'warning',
        detail: `Average GSC position ${Math.round(pos)} — consider refresh or restructure`,
      })
    }

    // Missing canonical_url
    if (!a.canonical_url) {
      issues.push({
        article_id: a.id,
        slug: a.slug as string,
        title: a.title as string,
        issue_type: 'no_canonical_url',
        severity: 'info',
        detail: 'No canonical URL configured',
      })
    }
  }

  const bySeverity = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  }

  return NextResponse.json({
    articles_scanned: rows.length,
    total_issues: issues.length,
    by_severity: bySeverity,
    issues: issues.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 }
      return order[a.severity] - order[b.severity]
    }),
    scanned_at: new Date().toISOString(),
  })
}
