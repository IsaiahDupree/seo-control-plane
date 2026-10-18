// Link equity analysis — identify articles with high inbound link authority for pillar detection
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 200)

  const admin = createAdminClient()

  const { data: edges, error } = await admin
    .from('scp_internal_link_edges')
    .select('to_article_id, from_article_id, is_pillar_link, semantic_score')
    .eq('app_id', appId)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Count inbound links per article
  const inboundMap = new Map<string, { count: number; pillar_links: number; score_sum: number }>()
  const outboundMap = new Map<string, number>()

  for (const e of edges ?? []) {
    const toId = e.to_article_id as string | null
    const fromId = e.from_article_id as string
    if (toId) {
      if (!inboundMap.has(toId)) inboundMap.set(toId, { count: 0, pillar_links: 0, score_sum: 0 })
      const entry = inboundMap.get(toId)!
      entry.count++
      if (e.is_pillar_link) entry.pillar_links++
      entry.score_sum += (e.semantic_score as number) ?? 0
    }
    outboundMap.set(fromId, (outboundMap.get(fromId) ?? 0) + 1)
  }

  const articleIds = [...new Set([...inboundMap.keys()])]
  const { data: articles } = articleIds.length
    ? await admin.from('scp_articles').select('id, slug, title, cluster_name, gsc_avg_position').in('id', articleIds)
    : { data: [] }

  const artLookup = new Map(((articles ?? []) as { id: string; slug: string; title: string; cluster_name: string | null; gsc_avg_position: number | null }[]).map((a) => [a.id, a]))

  const results = Array.from(inboundMap.entries())
    .map(([id, data]) => {
      const art = artLookup.get(id)
      const equityScore = data.count + data.pillar_links * 2 + (data.score_sum / Math.max(data.count, 1)) * 5
      return {
        article_id: id,
        slug: art?.slug ?? null,
        title: art?.title ?? null,
        cluster_name: art?.cluster_name ?? null,
        gsc_avg_position: art?.gsc_avg_position ?? null,
        inbound_links: data.count,
        pillar_links: data.pillar_links,
        avg_semantic_score: data.count > 0 ? Math.round((data.score_sum / data.count) * 100) / 100 : 0,
        outbound_links: outboundMap.get(id) ?? 0,
        link_equity_score: Math.round(equityScore * 10) / 10,
        is_likely_pillar: data.count >= 5 || data.pillar_links >= 2,
      }
    })
    .sort((a, b) => b.link_equity_score - a.link_equity_score)
    .slice(0, limit)

  return NextResponse.json({
    total_edges: edges?.length ?? 0,
    articles_analyzed: results.length,
    top_by_link_equity: results,
  })
}
