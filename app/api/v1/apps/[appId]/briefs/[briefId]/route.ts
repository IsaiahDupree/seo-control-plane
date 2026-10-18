import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { patchBriefBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; briefId: string }> }

const briefColumns =
  'id, app_id, keyword_id, article_id, content_request_id, focus_keyword, secondary_keywords, content_type, cluster_name, target_word_count, target_persona, competitor_urls, serp_analysis, tone_notes, cta_guidance, status, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, briefId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_content_briefs')
    .select(briefColumns)
    .eq('id', briefId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Brief not found')

  return NextResponse.json({ brief: data })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId, briefId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = patchBriefBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: existing, error: exErr } = await admin
    .from('scp_content_briefs')
    .select('id, status')
    .eq('id', briefId)
    .eq('app_id', appId)
    .maybeSingle()

  if (exErr) return jsonError(500, 'query_failed', exErr.message)
  if (!existing) return jsonError(404, 'not_found', 'Brief not found')

  const patch: Record<string, unknown> = {}
  const p = parsed.data
  if (p.status !== undefined) patch.status = p.status
  if (p.tone_notes !== undefined) patch.tone_notes = p.tone_notes
  if (p.cta_guidance !== undefined) patch.cta_guidance = p.cta_guidance

  const { data, error } = await admin
    .from('scp_content_briefs')
    .update(patch)
    .eq('id', briefId)
    .eq('app_id', appId)
    .select(briefColumns)
    .single()

  if (error) return jsonError(500, 'update_failed', error.message)

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'brief.patch',
    entity_type: 'brief',
    entity_id: briefId,
    performed_by: null,
    payload: {
      before: { status: existing.status },
      changes: parsed.data,
      source: 'api_key',
    },
  })

  return NextResponse.json({
    brief: data,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
