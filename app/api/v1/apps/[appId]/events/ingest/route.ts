import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { ingestEventsBody } from '@/lib/schemas'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

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

  const parsed = ingestEventsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const articleIds = [
    ...new Set(
      parsed.data.events.map((e) => e.article_id).filter((id): id is string => Boolean(id))
    ),
  ]
  if (articleIds.length > 0) {
    const { data: owned, error: ownErr } = await admin
      .from('scp_articles')
      .select('id')
      .eq('app_id', appId)
      .in('id', articleIds)

    if (ownErr) return jsonError(500, 'query_failed', ownErr.message)
    const ok = new Set((owned ?? []).map((r) => r.id as string))
    if (articleIds.some((id) => !ok.has(id))) {
      return jsonError(400, 'article_mismatch', 'One or more article_ids do not belong to this app')
    }
  }

  const rows = parsed.data.events.map((e) => ({
    app_id: appId,
    article_id: e.article_id ?? null,
    event_name: e.event_name,
    payload: e.payload ?? {},
    client_event_id: e.client_event_id ?? null,
    occurred_at: e.occurred_at ?? new Date().toISOString(),
  }))

  const { data, error } = await admin.from('scp_analytics_events').insert(rows).select('id')

  if (error) {
    return jsonError(500, 'insert_failed', error.message)
  }

  return NextResponse.json({ inserted: data?.length ?? rows.length })
}
