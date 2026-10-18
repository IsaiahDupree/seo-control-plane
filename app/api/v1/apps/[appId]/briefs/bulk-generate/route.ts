// F-CP-066: Brief bulk generation trigger
// Creates multiple briefs from the top unaddressed keyword opportunities.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const bulkGenerateBody = z.object({
  count: z.number().int().min(1).max(50).default(10),
  intent_type: z.enum(['informational', 'commercial_investigation', 'transactional']).optional(),
  cluster_name: z.string().max(150).optional(),
  min_search_volume: z.number().int().min(0).optional(),
  max_difficulty: z.number().min(0).max(100).optional(),
  from_keyword_ids: z.array(z.string().uuid()).max(50).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    json = {}
  }

  const parsed = bulkGenerateBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  // Check monthly quota
  const { data: app } = await admin
    .from('scp_apps')
    .select('monthly_article_limit, monthly_articles_generated, status')
    .eq('id', appId)
    .maybeSingle()

  if (!app) return jsonError(404, 'not_found', 'App not found')
  if (app.status !== 'active') return jsonError(403, 'app_inactive', 'App is not active')

  const remaining = (app.monthly_article_limit ?? 10) - (app.monthly_articles_generated ?? 0)
  const count = Math.min(parsed.data.count, remaining)

  if (count <= 0) {
    return jsonError(429, 'quota_exhausted', 'Monthly article quota exhausted')
  }

  // Find top keywords without a brief yet
  let kwQuery = admin
    .from('scp_keywords')
    .select('id, keyword, intent_type, cluster_name, search_volume, difficulty, opportunity_score')
    .eq('app_id', appId)
    .eq('status', 'active')
    .order('opportunity_score', { ascending: false, nullsFirst: false })
    .limit(count * 3) // over-fetch to allow dedup filtering

  if (parsed.data.intent_type) kwQuery = kwQuery.eq('intent_type', parsed.data.intent_type)
  if (parsed.data.cluster_name) kwQuery = kwQuery.eq('cluster_name', parsed.data.cluster_name)
  if (parsed.data.min_search_volume !== undefined) kwQuery = kwQuery.gte('search_volume', parsed.data.min_search_volume)
  if (parsed.data.max_difficulty !== undefined) kwQuery = kwQuery.lte('difficulty', parsed.data.max_difficulty)
  if (parsed.data.from_keyword_ids?.length) kwQuery = kwQuery.in('id', parsed.data.from_keyword_ids)

  const { data: keywords, error: kwErr } = await kwQuery
  if (kwErr) return jsonError(500, 'query_failed', kwErr.message)

  if (!keywords?.length) {
    return jsonError(404, 'no_keywords', 'No eligible keywords found matching the criteria')
  }

  // Get existing briefs / articles to avoid duplicates
  const [existingBriefs, existingArticles] = await Promise.all([
    admin
      .from('scp_briefs')
      .select('focus_keyword')
      .eq('app_id', appId)
      .not('status', 'eq', 'rejected'),
    admin
      .from('scp_articles')
      .select('focus_keyword')
      .eq('app_id', appId)
      .not('focus_keyword', 'is', null),
  ])

  const existingKeywords = new Set([
    ...(existingBriefs.data ?? []).map((b) => b.focus_keyword?.toLowerCase().trim()).filter(Boolean),
    ...(existingArticles.data ?? []).map((a) => a.focus_keyword?.toLowerCase().trim()).filter(Boolean),
  ])

  const eligible = keywords
    .filter((k) => !existingKeywords.has(k.keyword.toLowerCase().trim()))
    .slice(0, count)

  if (eligible.length === 0) {
    return jsonError(409, 'all_covered', 'All top keywords already have briefs or articles')
  }

  const now = new Date().toISOString()

  // Create briefs
  const briefRows = eligible.map((k) => ({
    app_id: appId,
    focus_keyword: k.keyword,
    cluster_name: k.cluster_name ?? null,
    intent_type: k.intent_type ?? null,
    keyword_id: k.id,
    status: 'pending',
    source: 'bulk_generate',
    created_at: now,
    updated_at: now,
  }))

  const { data: briefs, error: briefErr } = await admin
    .from('scp_briefs')
    .insert(briefRows)
    .select('id, focus_keyword, cluster_name, status')

  if (briefErr) return jsonError(500, 'insert_failed', briefErr.message)

  return NextResponse.json({
    created: briefs?.length ?? 0,
    requested: parsed.data.count,
    monthly_remaining_after: remaining - (briefs?.length ?? 0),
    briefs: briefs ?? [],
  }, { status: 201 })
}
