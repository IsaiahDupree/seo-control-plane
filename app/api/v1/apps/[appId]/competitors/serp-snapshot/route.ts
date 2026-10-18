// F-CP-050: SERP snapshot ingest — bulk ingest competitor rank positions per keyword
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const serpEntrySchema = z.object({
  keyword: z.string().min(1).max(200),
  competitor_domain: z.string().min(3).max(253),
  rank_position: z.number().int().min(1).max(1000),
  page_url: z.string().url().optional(),
  page_title: z.string().max(500).optional(),
})

const serpSnapshotBody = z.object({
  entries: z.array(serpEntrySchema).min(1).max(5000),
})

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

  const parsed = serpSnapshotBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const rows = parsed.data.entries.map((e) => ({
    app_id: appId,
    keyword: e.keyword.toLowerCase().trim(),
    competitor_domain: e.competitor_domain.toLowerCase(),
    rank_position: e.rank_position,
    page_url: e.page_url ?? null,
    page_title: e.page_title ?? null,
    fetched_at: now,
  }))

  // Upsert in batches of 500
  let ingested = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await admin
      .from('scp_competitor_serps')
      .upsert(batch, { onConflict: 'app_id,keyword,competitor_domain', ignoreDuplicates: false })

    if (error) {
      errors.push(error.message)
    } else {
      ingested += batch.length
    }
  }

  if (errors.length > 0 && ingested === 0) {
    return jsonError(500, 'ingest_failed', errors[0])
  }

  return NextResponse.json({
    ingested,
    total: parsed.data.entries.length,
    errors: errors.length > 0 ? errors.slice(0, 3) : undefined,
  })
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const domain = searchParams.get('domain')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 1000)

  const admin = createAdminClient()

  let query = admin
    .from('scp_competitor_serps')
    .select('keyword, competitor_domain, rank_position, page_url, page_title, fetched_at')
    .eq('app_id', appId)
    .order('rank_position', { ascending: true })
    .limit(limit)

  if (keyword) query = query.eq('keyword', keyword.toLowerCase().trim())
  if (domain) query = query.eq('competitor_domain', domain.toLowerCase())

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ serp_data: data ?? [], count: data?.length ?? 0 })
}
