// F-CP-008: App context version history (read)
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
  const syncType = searchParams.get('type') // 'product', 'personas', 'ctas', 'restrictions', 'publishing', 'brand_voice'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const admin = createAdminClient()

  let query = admin
    .from('scp_app_sync_logs')
    .select('id, sync_type, version, snapshot, performed_by, created_at')
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (syncType) query = query.eq('sync_type', syncType)

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  // Group by sync_type for summary
  const byType: Record<string, { latest_version: number; latest_at: string }> = {}
  for (const log of data ?? []) {
    if (!byType[log.sync_type] || log.version > byType[log.sync_type].latest_version) {
      byType[log.sync_type] = { latest_version: log.version, latest_at: log.created_at }
    }
  }

  return NextResponse.json({
    history: data ?? [],
    summary: byType,
  })
}
