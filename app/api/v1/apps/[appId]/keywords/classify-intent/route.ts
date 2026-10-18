// F-CP-041: Keyword intent classification via LLM
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { callLLM } from '@/lib/llm'

type RouteContext = { params: Promise<{ appId: string }> }

const classifyBody = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(200),
  save: z.boolean().default(true),
})

type IntentResult = {
  keyword: string
  intent_type: 'informational' | 'navigational' | 'commercial_investigation' | 'transactional'
  confidence: number
  reasoning: string
}

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

  const parsed = classifyBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const { keywords, save } = parsed.data

  const systemPrompt = `You are an expert SEO analyst specialising in keyword intent classification. Classify each keyword into exactly one of these four intent types:
- informational: user wants to learn or understand something
- navigational: user wants to find a specific website or page
- commercial_investigation: user is researching before a purchase decision
- transactional: user wants to complete an action (buy, sign up, download, etc.)

Return ONLY a JSON array with no extra text.`

  const userPrompt = `Classify the search intent for these keywords:
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Return a JSON array where each item has:
{
  "keyword": "exact keyword from input",
  "intent_type": "informational" | "navigational" | "commercial_investigation" | "transactional",
  "confidence": 0.0-1.0,
  "reasoning": "one sentence"
}

Return only the JSON array, no markdown.`

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

  let results: IntentResult[]
  try {
    const raw = llmResult.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    results = JSON.parse(raw)
    if (!Array.isArray(results)) throw new Error('not array')
  } catch {
    return jsonError(502, 'llm_parse_failed', 'LLM returned non-JSON response')
  }

  const VALID_INTENTS = new Set<string>([
    'informational',
    'navigational',
    'commercial_investigation',
    'transactional',
  ])

  const validated = results.filter(
    (r) => r.keyword && VALID_INTENTS.has(r.intent_type)
  )

  // Optionally save back to scp_keywords
  let saved = 0
  if (save && validated.length > 0) {
    const admin = createAdminClient()
    const now = new Date().toISOString()

    for (const r of validated) {
      const { error } = await admin
        .from('scp_keywords')
        .update({ intent_type: r.intent_type, updated_at: now })
        .eq('app_id', appId)
        .eq('keyword', r.keyword.toLowerCase().trim())
      if (!error) saved++
    }
  }

  return NextResponse.json({
    classified: validated.length,
    saved,
    results: validated,
    llm_cost_usd: llmResult.cost_usd,
  })
}
