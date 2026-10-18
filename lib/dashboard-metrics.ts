import type { SupabaseClient } from '@supabase/supabase-js'
import { countArticlesThisUtcMonth, isUnlimitedMonthlyLimit } from '@/lib/monthly-limit'

export type AppOperationalMetrics = {
  unassigned_keywords: number
  pending_briefs: number
  open_content_requests: number
  processing_content_requests: number
  articles_approved: number
  articles_queued: number
}

export async function getAppOperationalMetrics(
  db: SupabaseClient,
  appId: string
): Promise<AppOperationalMetrics> {
  const [
    { count: unassigned_keywords },
    { count: pending_briefs },
    { count: open_content_requests },
    { count: processing_content_requests },
    { count: articles_approved },
    { count: articles_queued },
  ] = await Promise.all([
    db.from('scp_keywords').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'unassigned'),
    db.from('scp_content_briefs').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'pending'),
    db.from('scp_content_requests').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'open'),
    db.from('scp_content_requests').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'processing'),
    db.from('scp_articles').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'approved'),
    db.from('scp_articles').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'queued'),
  ])

  return {
    unassigned_keywords: unassigned_keywords ?? 0,
    pending_briefs: pending_briefs ?? 0,
    open_content_requests: open_content_requests ?? 0,
    processing_content_requests: processing_content_requests ?? 0,
    articles_approved: articles_approved ?? 0,
    articles_queued: articles_queued ?? 0,
  }
}

export async function getAppSummaryPayload(db: SupabaseClient, appId: string) {
  const { data: app, error: appErr } = await db
    .from('scp_apps')
    .select(
      'id, slug, name, plan, status, monthly_article_limit, base_url, webhook_url, created_at, updated_at'
    )
    .eq('id', appId)
    .single()

  if (appErr || !app) return { error: appErr?.message ?? 'App not found' as const }

  const [metrics, articlesThisUtcMonth] = await Promise.all([
    getAppOperationalMetrics(db, appId),
    countArticlesThisUtcMonth(db, appId),
  ])

  const limit = app.monthly_article_limit as number
  const unlimited = isUnlimitedMonthlyLimit(limit)
  const monthly_remaining = unlimited ? null : Math.max(0, limit - articlesThisUtcMonth)

  return {
    app: {
      id: app.id,
      slug: app.slug,
      name: app.name,
      plan: app.plan,
      status: app.status,
      monthly_article_limit: limit,
      monthly_unlimited: unlimited,
      base_url: app.base_url,
      webhook_configured: Boolean(app.webhook_url),
      created_at: app.created_at,
      updated_at: app.updated_at,
    },
    usage: {
      articles_this_utc_month: articlesThisUtcMonth,
      monthly_remaining,
    },
    metrics,
    generated_at: new Date().toISOString(),
  }
}
