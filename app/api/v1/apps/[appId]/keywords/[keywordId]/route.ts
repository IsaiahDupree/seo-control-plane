import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchKeywordBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; keywordId: string }> }

const keywordColumns =
  'id, keyword, cluster_name, status, search_volume, difficulty, intent, priority_score, is_seed, article_id, last_refreshed_at, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, keywordId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_keywords')
    .select(keywordColumns)
    .eq('id', keywordId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Keyword not found')

  return NextResponse.json({ keyword: data })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, keywordId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchKeywordBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: existing, error: exErr } = await admin
    .from('scp_keywords')
    .select('id, cluster_name, status, priority_score, is_seed, article_id')
    .eq('id', keywordId)
    .eq('app_id', appId)
    .maybeSingle()

  if (exErr) return jsonError(500, 'query_failed', exErr.message)
  if (!existing) return jsonError(404, 'not_found', 'Keyword not found')

  if (parsed.data.article_id) {
    const { data: art, error: aErr } = await admin
      .from('scp_articles')
      .select('id')
      .eq('id', parsed.data.article_id)
      .eq('app_id', appId)
      .maybeSingle()

    if (aErr) return jsonError(500, 'query_failed', aErr.message)
    if (!art) return jsonError(400, 'article_mismatch', 'article_id does not belong to this app')
  }

  const patch: Record<string, unknown> = {}
  const p = parsed.data
  if (p.cluster_name !== undefined) patch.cluster_name = p.cluster_name
  if (p.status !== undefined) patch.status = p.status
  if (p.priority_score !== undefined) patch.priority_score = p.priority_score
  if (p.is_seed !== undefined) patch.is_seed = p.is_seed
  if (p.article_id !== undefined) patch.article_id = p.article_id

  const { data, error } = await admin
    .from('scp_keywords')
    .update(patch)
    .eq('id', keywordId)
    .eq('app_id', appId)
    .select(keywordColumns)
    .single()

  if (error) return jsonError(500, 'update_failed', error.message)

  const before: Record<string, unknown> = {}
  const pk = parsed.data
  if (pk.cluster_name !== undefined) before.cluster_name = existing.cluster_name
  if (pk.status !== undefined) before.status = existing.status
  if (pk.priority_score !== undefined) before.priority_score = existing.priority_score
  if (pk.is_seed !== undefined) before.is_seed = existing.is_seed
  if (pk.article_id !== undefined) before.article_id = existing.article_id

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'keyword.patch',
    entity_type: 'keyword',
    entity_id: keywordId,
    performed_by: null,
    payload: {
      source: 'api_key',
      before,
      changes: parsed.data,
    },
  })

  return NextResponse.json({
    keyword: data,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
