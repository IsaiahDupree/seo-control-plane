// F-CP-017: Keyword seed intake
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const seedSchema = z.object({
  keyword: z.string().min(1).max(200),
  is_brand_term: z.boolean().default(false),
  is_competitor_term: z.boolean().default(false),
  notes: z.string().max(500).optional(),
})

const seedsBody = z.object({
  seeds: z.array(seedSchema).min(1).max(200),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_keywords')
    .select('id, keyword, is_brand_term, is_competitor_term, search_volume, difficulty, intent_type, status, created_at')
    .eq('app_id', appId)
    .eq('is_seed', true)
    .order('created_at', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ seeds: data ?? [], count: data?.length ?? 0 })
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

  const parsed = seedsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const rows = parsed.data.seeds.map((s) => ({
    app_id: appId,
    keyword: s.keyword.trim().toLowerCase(),
    is_seed: true,
    is_brand_term: s.is_brand_term,
    is_competitor_term: s.is_competitor_term,
    source: 'seed',
    status: 'active',
    created_at: now,
    updated_at: now,
  }))

  const { data, error } = await admin
    .from('scp_keywords')
    .upsert(rows, { onConflict: 'app_id,keyword', ignoreDuplicates: false })
    .select('id, keyword, is_seed, is_brand_term, is_competitor_term, status')

  if (error) return jsonError(500, 'upsert_failed', error.message)

  return NextResponse.json({
    saved: data?.length ?? 0,
    seeds: data,
  })
}
