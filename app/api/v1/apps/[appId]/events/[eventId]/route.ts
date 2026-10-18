import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; eventId: string }> }

const eventColumns =
  'id, article_id, event_name, payload, client_event_id, occurred_at, created_at'

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, eventId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_analytics_events')
    .select(eventColumns)
    .eq('id', eventId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!data) return jsonError(404, 'not_found', 'Event not found')

  return NextResponse.json({ event: data })
}
