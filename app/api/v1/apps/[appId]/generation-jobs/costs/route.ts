// Generation cost tracking — aggregate LLM costs across generation jobs
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
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)

  const admin = createAdminClient()

  const { data: jobs, error } = await admin
    .from('scp_generation_jobs')
    .select('id, status, llm_provider, llm_model, total_tokens, cost_usd, created_at, completed_at')
    .eq('app_id', appId)
    .gte('created_at', `${since}T00:00:00Z`)
    .lte('created_at', `${until}T23:59:59Z`)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = jobs ?? []

  const completed = rows.filter((j) => j.status === 'complete')
  const failed = rows.filter((j) => j.status === 'failed')

  const totalCost = completed.reduce((s, j) => s + ((j.cost_usd as number) ?? 0), 0)
  const totalTokens = completed.reduce((s, j) => s + ((j.total_tokens as number) ?? 0), 0)

  // Per-model breakdown
  const modelMap = new Map<string, { count: number; cost: number; tokens: number }>()
  for (const j of completed) {
    const key = `${j.llm_provider ?? 'unknown'}/${j.llm_model ?? 'unknown'}`
    if (!modelMap.has(key)) modelMap.set(key, { count: 0, cost: 0, tokens: 0 })
    const m = modelMap.get(key)!
    m.count++
    m.cost += (j.cost_usd as number) ?? 0
    m.tokens += (j.total_tokens as number) ?? 0
  }

  const byModel = Array.from(modelMap.entries()).map(([model, data]) => ({
    model,
    job_count: data.count,
    total_cost_usd: Math.round(data.cost * 10000) / 10000,
    total_tokens: data.tokens,
    avg_cost_per_job: data.count > 0 ? Math.round((data.cost / data.count) * 10000) / 10000 : 0,
  })).sort((a, b) => b.total_cost_usd - a.total_cost_usd)

  return NextResponse.json({
    period: { since, until },
    summary: {
      total_jobs: rows.length,
      completed_jobs: completed.length,
      failed_jobs: failed.length,
      total_cost_usd: Math.round(totalCost * 10000) / 10000,
      total_tokens: totalTokens,
      avg_cost_per_article: completed.length > 0
        ? Math.round((totalCost / completed.length) * 10000) / 10000
        : 0,
    },
    by_model: byModel,
  })
}
