// Next-best keywords to target — ranked by opportunity, coverage gap, and intent
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)
  const cluster = searchParams.get('cluster')
  const intentType = searchParams.get('intent_type')

  const admin = createAdminClient()

  let kwQuery = admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, search_volume, opportunity_score, intent_type, status, article_id')
    .eq('app_id', appId)
    .eq('status', 'active')
    .is('article_id', null) // not yet assigned to an article
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(500)

  if (cluster) kwQuery = kwQuery.eq('cluster_name', cluster)
  if (intentType) kwQuery = kwQuery.eq('intent_type', intentType)

  const [kwResult, artResult] = await Promise.all([
    kwQuery,
    admin
      .from('scp_articles')
      .select('focus_keyword')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  // Build covered set
  const covered = new Set((artResult.data ?? []).map((a) => (a.focus_keyword as string | null)?.toLowerCase().trim()).filter(Boolean) as string[])

  const candidates = (kwResult.data ?? [])
    .filter((k) => !covered.has(k.keyword.toLowerCase().trim()))
    .slice(0, limit)
    .map((k) => ({
      keyword_id: k.id,
      keyword: k.keyword,
      cluster_name: k.cluster_name ?? null,
      search_volume: k.search_volume ?? null,
      opportunity_score: k.opportunity_score ?? null,
      intent_type: k.intent_type ?? null,
      recommendation: k.intent_type === 'informational'
        ? 'Create educational long-form content'
        : k.intent_type === 'commercial'
        ? 'Create comparison or alternatives article'
        : k.intent_type === 'transactional'
        ? 'Create BOFU landing-style article with CTA focus'
        : 'Create cluster article',
    }))

  return NextResponse.json({
    total_candidates: candidates.length,
    recommendations: candidates,
    generated_at: new Date().toISOString(),
  })
}
