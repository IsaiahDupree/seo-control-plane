// F-CP-060: Keyword CSV/JSON export
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ]
  return lines.join('\n')
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const format = searchParams.get('format') ?? 'json'
  const clusterId = searchParams.get('cluster_id')
  const intent = searchParams.get('intent')
  const status = searchParams.get('status')

  if (!['csv', 'json'].includes(format)) {
    return jsonError(400, 'invalid_format', 'format must be csv or json')
  }

  const admin = createAdminClient()

  let query = admin
    .from('scp_keywords')
    .select(
      'id, keyword, search_volume, difficulty, cpc_usd, intent_type, cluster_id, cluster_name, is_seed, is_competitor_term, status, source, created_at, updated_at'
    )
    .eq('app_id', appId)
    .order('search_volume', { ascending: false, nullsFirst: false })
    .limit(10000)

  if (clusterId) query = query.eq('cluster_id', clusterId)
  if (intent) query = query.eq('intent_type', intent)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = data ?? []

  if (format === 'csv') {
    const csv = toCSV(rows as Record<string, unknown>[])
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="keywords-${appId}.csv"`,
      },
    })
  }

  return NextResponse.json({ keywords: rows, count: rows.length })
}
