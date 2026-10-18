import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { keywordsBulkBody } from '@/lib/schemas'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const status = sp.get('status')
  const cluster = sp.get('cluster')

  const admin = createAdminClient()
  let q = admin
    .from('scp_keywords')
    .select(
      'id, keyword, cluster_name, status, search_volume, difficulty, intent, priority_score, is_seed, article_id, created_at'
    )
    .eq('app_id', appId)
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('keyword', { ascending: true })
    .range(offset, offset + limit - 1)

  if (status) q = q.eq('status', status)
  if (cluster) q = q.eq('cluster_name', cluster)

  const { data, error } = await q

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }

  const items = data ?? []
  return NextResponse.json({
    items,
    limit,
    offset,
    has_more: items.length === limit,
  })
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

  const parsed = keywordsBulkBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const rows = parsed.data.keywords.map((k) => ({
    app_id: appId,
    keyword: k.keyword.trim(),
    cluster_name: k.cluster_name ?? null,
    search_volume: k.search_volume ?? null,
    difficulty: k.difficulty ?? null,
    intent: k.intent ?? null,
    priority_score: k.priority_score ?? null,
    is_seed: k.is_seed ?? false,
  }))

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_keywords')
    .upsert(rows, { onConflict: 'app_id,keyword' })
    .select('id, keyword, cluster_name, status')

  if (error) {
    return jsonError(500, 'upsert_failed', error.message)
  }

  const upserted = data?.length ?? rows.length
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'keywords.bulk_upsert',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      keyword_count: parsed.data.keywords.length,
      upserted,
    },
  })

  return NextResponse.json({
    upserted,
    items: data ?? [],
    ...(audit_warning ? { audit_warning } : {}),
  })
}
