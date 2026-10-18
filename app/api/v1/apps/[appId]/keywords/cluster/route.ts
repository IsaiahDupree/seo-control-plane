// F-CP-045: Keyword clustering via LLM
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { callLLM } from '@/lib/llm'

type RouteContext = { params: Promise<{ appId: string }> }

const clusterBody = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(2).max(500).optional(),
  use_all_active: z.boolean().default(false),
  save: z.boolean().default(true),
})

type ClusterResult = {
  cluster_name: string
  pillar_keyword: string
  keywords: string[]
  intent_type: string
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

  const parsed = clusterBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  let keywords: string[]

  if (parsed.data.use_all_active) {
    const { data, error } = await admin
      .from('scp_keywords')
      .select('keyword')
      .eq('app_id', appId)
      .eq('status', 'active')
      .limit(500)
    if (error) return jsonError(500, 'query_failed', error.message)
    keywords = (data ?? []).map((k) => k.keyword)
  } else {
    keywords = parsed.data.keywords ?? []
  }

  if (keywords.length < 2) {
    return jsonError(400, 'too_few_keywords', 'Provide at least 2 keywords to cluster')
  }

  const systemPrompt = `You are an expert SEO content strategist. Group the provided keywords into topical clusters. Each cluster should represent a distinct content topic. Return ONLY a JSON array with no extra text.`

  const userPrompt = `Group these ${keywords.length} keywords into topical clusters:
${keywords.map((k, i) => `${i + 1}. ${k}`).join('\n')}

Rules:
- Each cluster should have a clear, descriptive name (2-5 words)
- Identify the best "pillar keyword" for each cluster (the broadest/highest-volume term)
- Group semantically related keywords together
- A keyword should belong to exactly one cluster
- Aim for clusters of 3-15 keywords each

Return a JSON array where each item has:
{
  "cluster_name": "Descriptive Cluster Name",
  "pillar_keyword": "the main keyword for this cluster",
  "keywords": ["kw1", "kw2", ...],
  "intent_type": "informational" | "commercial_investigation" | "transactional" | "mixed"
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
      4096
    )
  } catch (e) {
    return jsonError(502, 'llm_failed', e instanceof Error ? e.message : 'LLM call failed')
  }

  let clusters: ClusterResult[]
  try {
    const raw = llmResult.text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '')
    clusters = JSON.parse(raw)
    if (!Array.isArray(clusters)) throw new Error('not array')
  } catch {
    return jsonError(502, 'llm_parse_failed', 'LLM returned non-JSON response')
  }

  // Save cluster_name back to scp_keywords
  let saved = 0
  if (parsed.data.save && clusters.length > 0) {
    const now = new Date().toISOString()
    for (const cluster of clusters) {
      for (const kw of cluster.keywords) {
        const { error } = await admin
          .from('scp_keywords')
          .update({ cluster_name: cluster.cluster_name, updated_at: now })
          .eq('app_id', appId)
          .eq('keyword', kw.toLowerCase().trim())
        if (!error) saved++
      }
    }
  }

  return NextResponse.json({
    clusters,
    cluster_count: clusters.length,
    keywords_clustered: clusters.reduce((sum, c) => sum + c.keywords.length, 0),
    saved,
    llm_cost_usd: llmResult.cost_usd,
  })
}
