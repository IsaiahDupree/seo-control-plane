// Intent breakdown analytics — articles and keywords by intent type
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
      .select('intent_type, status, search_volume, opportunity_score')
      .eq('app_id', appId),
    admin
      .from('scp_articles')
      .select('intent_type, status, gsc_clicks, gsc_avg_position')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  const INTENTS = ['informational', 'navigational', 'commercial', 'transactional']

  const kwByIntent = new Map<string, { total: number; active: number; volume: number; opp: number }>()
  for (const k of kwResult.data ?? []) {
    const intent = (k.intent_type as string | null) ?? 'unknown'
    if (!kwByIntent.has(intent)) kwByIntent.set(intent, { total: 0, active: 0, volume: 0, opp: 0 })
    const e = kwByIntent.get(intent)!
    e.total++
    if (k.status === 'active') e.active++
    e.volume += (k.search_volume as number) ?? 0
    e.opp += (k.opportunity_score as number) ?? 0
  }

  const artByIntent = new Map<string, { total: number; published: number; clicks: number; pos_sum: number; pos_count: number }>()
  for (const a of artResult.data ?? []) {
    const intent = (a.intent_type as string | null) ?? 'unknown'
    if (!artByIntent.has(intent)) artByIntent.set(intent, { total: 0, published: 0, clicks: 0, pos_sum: 0, pos_count: 0 })
    const e = artByIntent.get(intent)!
    e.total++
    if (['published', 'indexed', 'ranked'].includes(a.status as string)) e.published++
    e.clicks += (a.gsc_clicks as number) ?? 0
    if (a.gsc_avg_position !== null) { e.pos_sum += a.gsc_avg_position as number; e.pos_count++ }
  }

  const allIntents = new Set([...INTENTS, ...kwByIntent.keys(), ...artByIntent.keys()])

  const breakdown = Array.from(allIntents).map((intent) => {
    const kw = kwByIntent.get(intent) ?? { total: 0, active: 0, volume: 0, opp: 0 }
    const art = artByIntent.get(intent) ?? { total: 0, published: 0, clicks: 0, pos_sum: 0, pos_count: 0 }
    return {
      intent_type: intent,
      keywords: { total: kw.total, active: kw.active, total_search_volume: kw.volume, avg_opportunity: kw.total > 0 ? Math.round(kw.opp / kw.total) : 0 },
      articles: {
        total: art.total,
        published: art.published,
        total_gsc_clicks: art.clicks,
        avg_position: art.pos_count > 0 ? Math.round((art.pos_sum / art.pos_count) * 10) / 10 : null,
      },
    }
  }).sort((a, b) => b.keywords.total - a.keywords.total)

  return NextResponse.json({ breakdown })
}
