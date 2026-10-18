// F-CP-002: App product context sync
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const productContextBody = z.object({
  tagline: z.string().max(200).optional(),
  one_liner: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  what_it_does: z.string().max(2000).optional(),
  what_problem_it_solves: z.string().max(2000).optional(),
  differentiators: z.array(z.string().max(300)).max(20).optional(),
  pricing_tiers: z
    .array(
      z.object({
        name: z.string(),
        price_usd: z.number().optional(),
        billing: z.enum(['monthly', 'annual', 'one_time', 'usage']).optional(),
        features: z.array(z.string()).optional(),
      })
    )
    .max(10)
    .optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_app_features')
    .select('*')
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ product: data ?? null })
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

  const parsed = productContextBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Fetch existing to get current version
  const { data: existing } = await admin
    .from('scp_app_features')
    .select('version')
    .eq('app_id', appId)
    .maybeSingle()

  const nextVersion = (existing?.version ?? 0) + 1

  const { data, error } = await admin
    .from('scp_app_features')
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

  // Log to version history (F-CP-008)
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'product',
    version: nextVersion,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ product: data, version: nextVersion }, { status: 200 })
}
