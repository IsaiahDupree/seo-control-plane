// Batch content planner — given a cluster or keyword set, plan a batch of articles
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const plannerBody = z.object({
  cluster_name: z.string().max(200).optional(),
  intent_types: z.array(z.enum(['informational', 'navigational', 'commercial', 'transactional'])).optional(),
  batch_size: z.number().int().min(1).max(100).default(10),
  min_opportunity_score: z.number().min(0).max(100).optional(),
  exclude_article_ids: z.array(z.string().uuid()).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = plannerBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const { cluster_name, intent_types, batch_size, min_opportunity_score, exclude_article_ids } = parsed.data

  const admin = createAdminClient()

  // Fetch uncovered active keywords
  let kwQuery = admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, search_volume, opportunity_score, intent_type')
    .eq('app_id', appId)
    .eq('status', 'active')
    .is('article_id', null)
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(1000)

  if (cluster_name) kwQuery = kwQuery.eq('cluster_name', cluster_name)
  if (intent_types && intent_types.length > 0) kwQuery = kwQuery.in('intent_type', intent_types)
  if (min_opportunity_score !== undefined) kwQuery = kwQuery.gte('opportunity_score', min_opportunity_score)

  const [kwResult, artResult] = await Promise.all([
    kwQuery,
    admin
      .from('scp_articles')
      .select('focus_keyword, id')
      .eq('app_id', appId)
      .not('status', 'eq', 'archived'),
  ])

  if (kwResult.error) return jsonError(500, 'query_failed', kwResult.error.message)

  // Build covered set
  const coveredKw = new Set((artResult.data ?? []).map((a) => (a.focus_keyword as string | null)?.toLowerCase().trim()).filter(Boolean) as string[])
  const excludeIds = new Set(exclude_article_ids ?? [])

  const candidates = (kwResult.data ?? [])
    .filter((k) => !coveredKw.has(k.keyword.toLowerCase().trim()))
    .filter((k) => !excludeIds.has(k.id as string))
    .slice(0, batch_size)

  // Suggest content type per intent
  const contentTypeMap: Record<string, string> = {
    informational: 'guide',
    commercial: 'comparison',
    transactional: 'pillar',
    navigational: 'cluster',
  }

  const plan = candidates.map((k, i) => ({
    position: i + 1,
    keyword_id: k.id,
    keyword: k.keyword,
    cluster_name: k.cluster_name ?? null,
    search_volume: k.search_volume ?? null,
    opportunity_score: k.opportunity_score ?? null,
    intent_type: k.intent_type ?? null,
    suggested_content_type: contentTypeMap[k.intent_type as string] ?? 'cluster',
    suggested_target_word_count: k.intent_type === 'informational' ? 2500 : k.intent_type === 'commercial' ? 2000 : 1500,
  }))

  return NextResponse.json({
    batch_size: plan.length,
    cluster_name: cluster_name ?? null,
    plan,
    estimated_total_words: plan.reduce((s, p) => s + p.suggested_target_word_count, 0),
    planned_at: new Date().toISOString(),
  })
}
