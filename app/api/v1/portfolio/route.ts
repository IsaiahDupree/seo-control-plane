// Portfolio multi-app summary — aggregate stats across all registered apps
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { jsonError } from '@/lib/api-errors'

const PORTFOLIO_SECRET = process.env.SCP_PORTFOLIO_SECRET ?? process.env.CRON_SECRET ?? ''

function authOk(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') ?? ''
  return auth === `Bearer ${PORTFOLIO_SECRET}` && PORTFOLIO_SECRET.length > 0
}

export async function GET(request: NextRequest) {
  if (!authOk(request)) {
    return jsonError(401, 'unauthorized', 'Portfolio secret required')
  }

  const admin = createAdminClient()

  const [appsResult, articlesResult, keywordsResult] = await Promise.all([
    admin.from('scp_apps').select('id, slug, name, domain, status, plan, monthly_article_limit, monthly_articles_generated'),
    admin.from('scp_articles').select('app_id, status, published_at, gsc_clicks, gsc_avg_position').limit(50000),
    admin.from('scp_keywords').select('app_id, status, cluster_name').limit(50000),
  ])

  if (appsResult.error) return jsonError(500, 'query_failed', appsResult.error.message)

  const apps = appsResult.data ?? []
  const articles = articlesResult.data ?? []
  const keywords = keywordsResult.data ?? []

  // Group articles and keywords by app_id
  const articlesByApp = new Map<string, typeof articles>()
  for (const a of articles) {
    const aid = a.app_id as string
    if (!articlesByApp.has(aid)) articlesByApp.set(aid, [])
    articlesByApp.get(aid)!.push(a)
  }

  const kwByApp = new Map<string, typeof keywords>()
  for (const k of keywords) {
    const aid = k.app_id as string
    if (!kwByApp.has(aid)) kwByApp.set(aid, [])
    kwByApp.get(aid)!.push(k)
  }

  const portfolio = apps.map((app) => {
    const appArticles = articlesByApp.get(app.id) ?? []
    const appKw = kwByApp.get(app.id) ?? []

    const published = appArticles.filter((a) => ['published', 'indexed', 'ranked'].includes(a.status as string))
    const totalClicks = published.reduce((s, a) => s + ((a.gsc_clicks as number) ?? 0), 0)
    const positions = published.map((a) => a.gsc_avg_position as number | null).filter((p): p is number => p !== null)
    const avgPosition = positions.length > 0 ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null

    return {
      app_id: app.id,
      slug: app.slug,
      name: app.name,
      domain: app.domain ?? null,
      status: app.status,
      plan: app.plan,
      monthly_article_limit: app.monthly_article_limit,
      monthly_articles_generated: app.monthly_articles_generated ?? 0,
      stats: {
        total_articles: appArticles.length,
        published_articles: published.length,
        draft_articles: appArticles.filter((a) => a.status === 'draft').length,
        total_active_keywords: appKw.filter((k) => k.status === 'active').length,
        total_gsc_clicks: totalClicks,
        avg_gsc_position: avgPosition,
        unique_clusters: new Set(appKw.map((k) => k.cluster_name).filter(Boolean)).size,
      },
    }
  })

  const totals = {
    total_apps: apps.length,
    active_apps: apps.filter((a) => a.status === 'active').length,
    total_published_articles: portfolio.reduce((s, a) => s + a.stats.published_articles, 0),
    total_gsc_clicks: portfolio.reduce((s, a) => s + a.stats.total_gsc_clicks, 0),
    total_active_keywords: portfolio.reduce((s, a) => s + a.stats.total_active_keywords, 0),
  }

  return NextResponse.json({ totals, apps: portfolio, generated_at: new Date().toISOString() })
}
