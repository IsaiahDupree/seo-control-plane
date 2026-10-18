import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'
import { schedulePublishBody } from '@/lib/schemas'

type RouteContext = { params: Promise<{ appId: string }> }

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

  const parsed = schedulePublishBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const spacingMs = parsed.data.spacing_minutes * 60 * 1000
  const startMs = parsed.data.first_publish_at
    ? Date.parse(parsed.data.first_publish_at)
    : Date.now()
  if (Number.isNaN(startMs)) {
    return jsonError(400, 'invalid_date', 'first_publish_at is not a valid date')
  }

  let query = admin
    .from('scp_articles')
    .select('id')
    .eq('app_id', appId)
    .eq('status', 'approved')
    .is('scheduled_publish_at', null)
    .order('created_at', { ascending: true })

  if (parsed.data.article_ids?.length) {
    query = query.in('id', parsed.data.article_ids)
  }

  const defaultCap = parsed.data.article_ids?.length ?? 20
  const limit = Math.min(50, Math.max(1, parsed.data.limit ?? defaultCap))
  const { data: candidates, error: qErr } = await query.limit(limit)

  if (qErr) {
    return jsonError(500, 'query_failed', qErr.message)
  }

  const ids = (candidates ?? []).map((r) => r.id)
  if (ids.length === 0) {
    return NextResponse.json({ scheduled: [], message: 'No approved articles without a schedule' })
  }

  const scheduleMeta = {
    spacing_minutes: parsed.data.spacing_minutes,
    first_publish_at: parsed.data.first_publish_at ?? null,
    article_ids_filter: parsed.data.article_ids ?? null,
    limit,
  }

  const { error: delErr } = await admin
    .from('scp_publish_queue')
    .delete()
    .in('article_id', ids)
    .eq('status', 'pending')

  if (delErr) {
    return jsonError(500, 'queue_clear_failed', delErr.message)
  }

  const scheduled: { article_id: string; scheduled_publish_at: string; queue_id: string }[] = []

  for (let i = 0; i < ids.length; i++) {
    const articleId = ids[i]
    const scheduledFor = new Date(startMs + i * spacingMs).toISOString()

    const { error: uErr } = await admin
      .from('scp_articles')
      .update({
        status: 'queued',
        scheduled_publish_at: scheduledFor,
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId)
      .eq('app_id', appId)

    if (uErr) {
      return jsonError(500, 'article_update_failed', uErr.message)
    }

    const { data: qRow, error: insErr } = await admin
      .from('scp_publish_queue')
      .insert({
        article_id: articleId,
        position: i,
        scheduled_for: scheduledFor,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insErr || !qRow) {
      return jsonError(500, 'queue_insert_failed', insErr?.message ?? 'insert failed')
    }

    scheduled.push({
      article_id: articleId,
      scheduled_publish_at: scheduledFor,
      queue_id: qRow.id,
    })
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'content.schedule',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      ...scheduleMeta,
      count: scheduled.length,
      scheduled,
    },
  })

  return NextResponse.json({
    scheduled,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
