// F-CP-048: Long-tail keyword expansion via LLM
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { callLLM } from '@/lib/llm'

type RouteContext = { params: Promise<{ appId: string }> }

const expandBody = z.object({
  pillar_keyword: z.string().min(2).max(200),
  persona_name: z.string().max(100).optional(),
  count: z.number().int().min(5).max(50).default(30),
  include_competitor_terms: z.boolean().default(false),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = expandBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const { pillar_keyword, persona_name, count, include_competitor_terms } = parsed.data
  const admin = createAdminClient()

  // Fetch app product context for better personalization
  const { data: features } = await admin
    .from('scp_app_features')
    .select('category, what_it_does, one_liner')
    .eq('app_id', appId)
    .maybeSingle()

  const productContext = features
    ? `Product: ${features.one_liner ?? features.what_it_does ?? features.category ?? 'unknown'}`
    : ''

  const personaContext = persona_name ? `Target persona: ${persona_name}` : ''

  const systemPrompt = `You are an expert SEO keyword researcher. Generate long-tail keyword variations that are realistic search queries with genuine search intent. Return ONLY a JSON array of objects with no extra text.`

  const userPrompt = `Generate ${count} long-tail keyword variations for the pillar keyword: "${pillar_keyword}"

${productContext}
${personaContext}

Include variations using these patterns:
- "best [keyword] for [persona/use case]"
- "[keyword] vs [alternative]"
- "how to [action] with [keyword]"
- "[keyword] for [industry/role]"
- "[adjective] [keyword] [modifier]"
- "what is [keyword]" / "why [keyword]"
- "[keyword] tips/guide/tutorial/review"
- "[keyword] [year]" for time-sensitive terms
${include_competitor_terms ? '- "[keyword] alternative" / "[keyword] competitor"' : ''}

Return a JSON array where each item has:
{
  "keyword": "the long-tail keyword phrase",
  "intent_type": "informational" | "commercial_investigation" | "transactional" | "navigational",
  "estimated_difficulty": 1-100,
  "pattern": "the pattern used (e.g. 'how_to', 'comparison', 'persona_fit', 'definition', 'guide')"
}

Return only the JSON array, no markdown, no explanation.`

  let llmResult: { text: string; cost_usd: number }
  try {
    llmResult = await callLLM(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      'gpt-4o-mini',
      2048
    )
  } catch (e) {
    return jsonError(502, 'llm_failed', e instanceof Error ? e.message : 'LLM call failed')
  }

  let expansions: Array<{
    keyword: string
    intent_type: string
    estimated_difficulty: number
    pattern: string
  }>
  try {
    const raw = llmResult.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    expansions = JSON.parse(raw)
    if (!Array.isArray(expansions)) throw new Error('not array')
  } catch {
    return jsonError(502, 'llm_parse_failed', 'LLM returned non-JSON response')
  }

  const VALID_INTENTS = new Set([
    'informational',
    'navigational',
    'commercial_investigation',
    'transactional',
  ])

  const now = new Date().toISOString()
  const rows = expansions
    .filter((e) => e.keyword && typeof e.keyword === 'string')
    .slice(0, 50)
    .map((e) => ({
      app_id: appId,
      keyword: e.keyword.trim().toLowerCase(),
      intent_type: VALID_INTENTS.has(e.intent_type) ? e.intent_type : null,
      difficulty: typeof e.estimated_difficulty === 'number' ? e.estimated_difficulty : null,
      cluster_name: pillar_keyword,
      source: 'llm_expansion',
      status: 'active',
      created_at: now,
      updated_at: now,
    }))

  if (rows.length === 0) {
    return jsonError(502, 'no_keywords', 'LLM generated no valid keywords')
  }

  const { data: saved, error: upsertErr } = await admin
    .from('scp_keywords')
    .upsert(rows, { onConflict: 'app_id,keyword', ignoreDuplicates: true })
    .select('id, keyword, intent_type, difficulty, cluster_name')

  if (upsertErr) return jsonError(500, 'upsert_failed', upsertErr.message)

  return NextResponse.json({
    pillar_keyword,
    generated: expansions.length,
    saved: saved?.length ?? 0,
    keywords: saved,
    llm_cost_usd: llmResult.cost_usd,
  })
}
