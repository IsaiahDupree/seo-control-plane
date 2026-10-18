// F-CP-049: Keyword rank tracking — ingest and read GSC-derived rank positions
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const rankEntrySchema = z.object({
  keyword: z.string().min(1).max(200),
  position: z.number().min(1).max(1000),
  url: z.string().url().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  impressions: z.number().int().min(0).optional(),
  clicks: z.number().int().min(0).optional(),
  ctr: z.number().min(0).max(1).optional(),
})

const rankBody = z.object({
  entries: z.array(rankEntrySchema).min(1).max(5000),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const dateFrom = searchParams.get('date_from')
  const dateTo = searchParams.get('date_to')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 1000)

  const admin = createAdminClient()

  let query = admin
    .from('scp_gsc_performance')
    .select('query, avg_position, page_url, date, impressions, clicks, ctr')
    .eq('app_id', appId)
    .order('date', { ascending: false })
    .limit(limit)

  if (keyword) query = query.ilike('query', keyword)
  if (dateFrom) query = query.gte('date', dateFrom)
  if (dateTo) query = query.lte('date', dateTo)

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  // Aggregate: latest position per keyword
  const latestByKeyword = new Map<string, typeof data[number]>()
  for (const row of data ?? []) {
    if (!latestByKeyword.has(row.query ?? '')) {
      latestByKeyword.set(row.query ?? '', row)
    }
  }

  return NextResponse.json({
    tracking: data ?? [],
    total: data?.length ?? 0,
    latest_by_keyword: Array.from(latestByKeyword.values()),
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

  const parsed = rankBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  const rows = parsed.data.entries.map((e) => ({
    app_id: appId,
    query: e.keyword.toLowerCase().trim(),
    avg_position: e.position,
    page_url: e.url ?? null,
    date: e.date ?? today,
    impressions: e.impressions ?? null,
    clicks: e.clicks ?? null,
    ctr: e.ctr ?? null,
    fetched_at: now,
  }))

  const { data, error } = await admin
    .from('scp_gsc_performance')
    .upsert(rows, { onConflict: 'app_id,query,date', ignoreDuplicates: false })
    .select('id, query, avg_position, date')

  if (error) return jsonError(500, 'upsert_failed', error.message)

  return NextResponse.json({ ingested: data?.length ?? 0, total: parsed.data.entries.length })
}
