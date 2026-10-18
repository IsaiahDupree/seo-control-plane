import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { getAppOperationalMetrics } from '@/lib/dashboard-metrics'

type RouteContext = { params: Promise<{ appId: string }> }

/**
 * Topical gaps (placeholder array) plus live pipeline hints.
 * Wire `gaps` to clustering + GSC in a later phase.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const [metrics, { count: openRequests, error: reqErr }] = await Promise.all([
    getAppOperationalMetrics(admin, appId),
    admin
      .from('scp_content_requests')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('status', 'open'),
  ])

  if (reqErr) {
    return jsonError(500, 'query_failed', reqErr.message)
  }

  return NextResponse.json({
    gaps: [] as { topic: string; score: number; rationale: string }[],
    open_content_requests: openRequests ?? 0,
    metrics,
    generated_at: new Date().toISOString(),
  })
}
