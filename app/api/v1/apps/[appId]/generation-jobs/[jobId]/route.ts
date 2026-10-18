import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; jobId: string }> }

const jobColumns =
  'id, brief_id, article_id, status, llm_provider, llm_model, total_tokens, cost_usd, error_message, started_at, completed_at, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, jobId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_generation_jobs')
    .select(jobColumns)
    .eq('id', jobId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Generation job not found')

  return NextResponse.json({ job: data })
}
