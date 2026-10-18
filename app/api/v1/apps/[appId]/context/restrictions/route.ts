// F-CP-005: App content restrictions sync
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const restrictionsBody = z.object({
  approved_claims: z.array(z.string().max(500)).max(100).optional(),
  prohibited_claims: z.array(z.string().max(500)).max(100).optional(),
  required_disclaimers: z.array(z.string().max(1000)).max(20).optional(),
  competitor_mention_policy: z
    .enum(['allow', 'neutral_only', 'prohibit'])
    .optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_app_restrictions')
    .select('*')
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ restrictions: data ?? null })
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

  const parsed = restrictionsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: existing } = await admin
    .from('scp_app_restrictions')
    .select('version')
    .eq('app_id', appId)
    .maybeSingle()

  const nextVersion = (existing?.version ?? 0) + 1

  const { data, error } = await admin
    .from('scp_app_restrictions')
    .upsert(
      {
        app_id: appId,
        ...parsed.data,
        version: nextVersion,
        updated_at: now,
      },
      { onConflict: 'app_id' }
    )
    .select('*')
    .single()

  if (error) return jsonError(500, 'upsert_failed', error.message)

  // Version history (F-CP-008)
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'restrictions',
    version: nextVersion,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ restrictions: data, version: nextVersion }, { status: 200 })
}
