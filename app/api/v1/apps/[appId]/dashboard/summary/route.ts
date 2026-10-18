import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { getAppSummaryPayload } from '@/lib/dashboard-metrics'

type RouteContext = { params: Promise<{ appId: string }> }

/** Operator snapshot: plan, monthly usage, pipeline counts. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const payload = await getAppSummaryPayload(admin, appId)

  if ('error' in payload) {
    return jsonError(404, 'not_found', payload.error ?? 'App not found')
  }

  return NextResponse.json(payload)
}
