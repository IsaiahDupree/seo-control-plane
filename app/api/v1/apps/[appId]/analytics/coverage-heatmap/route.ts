// Coverage heatmap — cluster × intent matrix showing article and keyword coverage
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

  const [kwResult, artResult] = await Promise.all([
    admin
      .from('scp_keywords')
      .select('cluster_name, intent_type, status')
      .eq('app_id', appId)
      .not('cluster_name', 'is', null),
    admin
      .from('scp_articles')
      .select('cluster_name, intent_type, status')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived')
      .not('cluster_name', 'is', null),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const INTENTS = ['informational', 'navigational', 'commercial', 'transactional']

  // Build cluster set
  const clusters = new Set<string>()
  for (const k of kwResult.data ?? []) if (k.cluster_name) clusters.add(k.cluster_name as string)
  for (const a of artResult.data ?? []) if (a.cluster_name) clusters.add(a.cluster_name as string)

  // Count keywords per cluster+intent
  const kwMap = new Map<string, number>()
  for (const k of kwResult.data ?? []) {
    if (k.status !== 'active') continue
    const key = `${k.cluster_name}::${k.intent_type ?? 'unknown'}`
    kwMap.set(key, (kwMap.get(key) ?? 0) + 1)
  }

  // Count articles per cluster+intent
  const artMap = new Map<string, number>()
  for (const a of artResult.data ?? []) {
    const key = `${a.cluster_name}::${a.intent_type ?? 'unknown'}`
    artMap.set(key, (artMap.get(key) ?? 0) + 1)
  }

  const heatmap = Array.from(clusters).sort().map((cluster) => {
    const cells = INTENTS.map((intent) => {
      const key = `${cluster}::${intent}`
      const kw_count = kwMap.get(key) ?? 0
      const art_count = artMap.get(key) ?? 0
      return {
        intent_type: intent,
        keywords: kw_count,
        articles: art_count,
        coverage: kw_count === 0
          ? 'no_keywords'
          : art_count === 0
          ? 'gap'
          : art_count < kw_count * 0.3
          ? 'thin'
          : 'covered',
      }
    })
    return { cluster_name: cluster, cells }
  })

  return NextResponse.json({
    clusters: heatmap.length,
    intents: INTENTS,
    heatmap,
  })
}
