// F-CP-025: App usage / quota endpoint
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

  const [appResult, articleCountResult, briefCountResult, deliveryCountResult, keywordCountResult] =
    await Promise.all([
      admin
        .from('scp_apps')
        .select(
          'id, name, plan, status, monthly_article_limit, monthly_articles_generated, quota_reset_at, created_at'
        )
        .eq('id', appId)
        .maybeSingle(),
      // Total articles ever generated
      admin
        .from('scp_articles')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', appId),
      // Pending/processing briefs
      admin
        .from('scp_briefs')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', appId)
        .in('status', ['pending', 'processing']),
      // Successful deliveries this month
      admin
        .from('scp_deliveries')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', appId)
        .eq('status', 'delivered')
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
      // Total keywords tracked
      admin
        .from('scp_keywords')
        .select('id', { count: 'exact', head: true })
        .eq('app_id', appId)
        .eq('status', 'active'),
    ])

  if (appResult.error || !appResult.data) {
    return jsonError(404, 'not_found', 'App not found')
  }

  const app = appResult.data
  const monthlyLimit = app.monthly_article_limit ?? 10
  const monthlyUsed = app.monthly_articles_generated ?? 0
  const monthlyRemaining = Math.max(0, monthlyLimit - monthlyUsed)
  const pctUsed = monthlyLimit > 0 ? Math.round((monthlyUsed / monthlyLimit) * 100) : 0

  // Next reset: first day of next month
  const now = new Date()
  const nextReset =
    app.quota_reset_at ??
    new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  return NextResponse.json({
    app_id: appId,
    plan: app.plan ?? 'starter',
    status: app.status,
    quota: {
      monthly_limit: monthlyLimit,
      monthly_used: monthlyUsed,
      monthly_remaining: monthlyRemaining,
      pct_used: pctUsed,
      quota_reset_at: nextReset,
      warning: pctUsed >= 80,
      exhausted: monthlyRemaining === 0,
    },
    lifetime: {
      total_articles_generated: articleCountResult.count ?? 0,
      total_deliveries_this_month: deliveryCountResult.count ?? 0,
    },
    pipeline: {
      pending_briefs: briefCountResult.count ?? 0,
    },
    keywords: {
      active_count: keywordCountResult.count ?? 0,
    },
    member_since: app.created_at,
  })
}
