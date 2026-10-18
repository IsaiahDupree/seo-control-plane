// F-CP-009: Publishing window configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const publishingBody = z.object({
  daily_publish_limit: z.number().int().min(1).max(20).optional(),
  publish_start_hour: z.number().int().min(0).max(23).optional(),
  publish_end_hour: z.number().int().min(0).max(23).optional(),
  publish_days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  min_interval_hours: z.number().int().min(1).max(48).optional(),
  timezone: z.string().max(60).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_app_publishing')
    .select('*')
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({
    publishing: data ?? {
      daily_publish_limit: 2,
      publish_start_hour: 8,
      publish_end_hour: 18,
      publish_days: [1, 2, 3, 4, 5],
      min_interval_hours: 4,
      timezone: 'UTC',
    },
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

  const parsed = publishingBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const { publish_start_hour, publish_end_hour } = parsed.data
  if (
    publish_start_hour !== undefined &&
    publish_end_hour !== undefined &&
    publish_start_hour >= publish_end_hour
  ) {
    return jsonError(400, 'invalid_window', 'publish_start_hour must be less than publish_end_hour')
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('scp_app_publishing')
    .upsert({ app_id: appId, ...parsed.data, updated_at: now }, { onConflict: 'app_id' })
    .select('*')
    .single()

  if (error) return jsonError(500, 'upsert_failed', error.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'publishing',
    version: 1,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ publishing: data }, { status: 200 })
}
