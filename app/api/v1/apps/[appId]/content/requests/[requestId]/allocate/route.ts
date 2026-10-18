import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; requestId: string }> }

/**
 * Attach up to `requested_count` unassigned keywords to new content briefs for this open request.
 * Call `POST /generate` with each `brief_id`, or `POST /briefs/:id/generate`.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const { appId, requestId } = await context.params
  const gate = await requireAppAuth(_request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: reqRow, error: reqErr } = await admin
    .from('scp_content_requests')
    .select('id, app_id, requested_count, status')
    .eq('id', requestId)
    .eq('app_id', appId)
    .single()

  if (reqErr || !reqRow) {
    return jsonError(404, 'not_found', 'Content request not found')
  }
  if (reqRow.status !== 'open') {
    return jsonError(409, 'not_open', `Request status is "${reqRow.status}"`)
  }

  const n = reqRow.requested_count as number

  const { data: keywords, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, intent')
    .eq('app_id', appId)
    .eq('status', 'unassigned')
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: true })
    .limit(n)

  if (kwErr) {
    return jsonError(500, 'query_failed', kwErr.message)
  }

  const picked = keywords ?? []
  if (picked.length < n) {
    return jsonError(
      422,
      'insufficient_keywords',
      `Need ${n} unassigned keywords; only ${picked.length} available. Seed keywords first.`
    )
  }

  const briefIds: string[] = []

  for (const kw of picked) {
    const { data: brief, error: insErr } = await admin
      .from('scp_content_briefs')
      .insert({
        app_id: appId,
        keyword_id: kw.id,
        content_request_id: requestId,
        focus_keyword: kw.keyword,
        secondary_keywords: [],
        content_type: 'cluster',
        cluster_name: (kw.cluster_name as string) ?? null,
        target_word_count: 1800,
        target_persona: null,
        competitor_urls: [],
        tone_notes: null,
        cta_guidance: null,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insErr || !brief) {
      return jsonError(500, 'brief_insert_failed', insErr?.message ?? 'Failed to create brief')
    }

    briefIds.push(brief.id)

    const { error: upKw } = await admin
      .from('scp_keywords')
      .update({ status: 'brief_created' })
      .eq('id', kw.id)
      .eq('app_id', appId)

    if (upKw) {
      return jsonError(500, 'keyword_update_failed', upKw.message)
    }
  }

  const { error: upReq } = await admin
    .from('scp_content_requests')
    .update({ status: 'processing' })
    .eq('id', requestId)
    .eq('app_id', appId)

  if (upReq) {
    return jsonError(500, 'request_update_failed', upReq.message)
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'content_request.allocated',
    entity_type: 'content_request',
    entity_id: requestId,
    performed_by: null,
    payload: {
      source: 'api_key',
      brief_ids: briefIds,
      keywords_allocated: picked.length,
    },
  })

  return NextResponse.json({
    request_id: requestId,
    status: 'processing',
    brief_ids: briefIds,
    keywords_allocated: picked.length,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
