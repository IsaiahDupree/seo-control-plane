// Experiment results — aggregate A/B test outcomes across the app
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
  const status = searchParams.get('status') // 'active' | 'concluded' | null
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 100)

  const admin = createAdminClient()

  let query = admin
    .from('scp_experiments')
    .select('id, article_id, variant_name, hypothesis, status, winner, started_at, concluded_at, metrics')
    .eq('app_id', appId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data: experiments, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = experiments ?? []
  const active = rows.filter((e) => e.status === 'active').length
  const concluded = rows.filter((e) => e.status === 'concluded').length
  const withWinner = rows.filter((e) => e.winner !== null).length

  // Enrich with article info
  const artIds = [...new Set(rows.map((e) => e.article_id as string).filter(Boolean))]
  const { data: articles } = artIds.length
    ? await admin.from('scp_articles').select('id, slug, title').in('id', artIds)
    : { data: [] }

  const artMap = new Map(((articles ?? []) as { id: string; slug: string; title: string }[]).map((a) => [a.id, a]))

  const enriched = rows.map((e) => {
    const art = artMap.get(e.article_id as string)
    return {
      experiment_id: e.id,
      article_id: e.article_id,
      slug: art?.slug ?? null,
      title: art?.title ?? null,
      variant_name: e.variant_name,
      hypothesis: e.hypothesis,
      status: e.status,
      winner: e.winner ?? null,
      started_at: e.started_at,
      concluded_at: e.concluded_at ?? null,
      metrics: e.metrics ?? {},
    }
  })

  return NextResponse.json({
    total: rows.length,
    active,
    concluded,
    with_winner: withWinner,
    experiments: enriched,
  })
}
