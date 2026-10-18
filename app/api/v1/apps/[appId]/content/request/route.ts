import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { contentRequestBody } from '@/lib/schemas'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

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

  const parsed = contentRequestBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_content_requests')
    .insert({
      app_id: appId,
      requested_count: parsed.data.batch_size,
      notes: parsed.data.notes ?? null,
      status: 'open',
    })
    .select('id, requested_count, status, created_at')
    .single()

  if (error || !data) {
    return jsonError(500, 'insert_failed', error?.message ?? 'Failed to record request')
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'content_request.created',
    entity_type: 'content_request',
    entity_id: data.id,
    performed_by: null,
    payload: {
      source: 'api_key',
      requested_count: data.requested_count,
      notes: parsed.data.notes ?? null,
    },
  })

  return NextResponse.json({
    request_id: data.id,
    batch_size: data.requested_count,
    status: data.status,
    created_at: data.created_at,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
