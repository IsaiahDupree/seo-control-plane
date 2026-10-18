import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/** Recent rows from scp_gsc_performance (after POST .../gsc-sync). */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') ?? '100', 10) || 100))
  const from = sp.get('from')
  const to = sp.get('to')

  const admin = createAdminClient()
  let q = admin
    .from('scp_gsc_performance')
    .select('id, gsc_query, clicks, impressions, ctr, position, date, created_at')
    .eq('app_id', appId)
    .order('date', { ascending: false })
    .limit(limit)

  if (from) q = q.gte('date', from)
  if (to) q = q.lte('date', to)

  const { data, error } = await q

  if (error) {
    if (error.code === '42P01' || error.message?.includes('does not exist')) {
      return jsonError(503, 'table_missing', 'Run migration 005_scp_gsc_performance.sql')
    }
    return jsonError(500, 'query_failed', error.message)
  }

  return NextResponse.json({ items: data ?? [] })
}
