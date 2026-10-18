// F-CP-063: Article A/B test summary endpoint
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

  const { data: experiments, error } = await admin
    .from('scp_experiments')
    .select('id, variant_name, status, impressions, clicks, ctr, created_at, concluded_at, winner')
    .eq('article_id', articleId)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  const exps = experiments ?? []
  const active = exps.filter((e) => e.status === 'running')
  const concluded = exps.filter((e) => e.status === 'concluded')

  const totalImpressions = exps.reduce((s, e) => s + ((e.impressions as number) ?? 0), 0)
  const totalClicks = exps.reduce((s, e) => s + ((e.clicks as number) ?? 0), 0)

  const winner = concluded.find((e) => e.winner === true) ?? null

  return NextResponse.json({
    article_id: articleId,
    experiment_count: exps.length,
    active_count: active.length,
    concluded_count: concluded.length,
    total_impressions: totalImpressions,
    total_clicks: totalClicks,
    overall_ctr: totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : null,
    winning_variant: winner ? { id: winner.id, variant_name: winner.variant_name, ctr: winner.ctr } : null,
    experiments: exps.map((e) => ({
      id: e.id,
      variant_name: e.variant_name,
      status: e.status,
      impressions: e.impressions ?? 0,
      clicks: e.clicks ?? 0,
      ctr: e.ctr ?? null,
      winner: e.winner ?? false,
      created_at: e.created_at,
      concluded_at: e.concluded_at ?? null,
    })),
  })
}
