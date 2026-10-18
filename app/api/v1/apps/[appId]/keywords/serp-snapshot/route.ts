// Keyword SERP snapshot — store and retrieve SERP position snapshots for keywords
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const snapshotBody = z.object({
  snapshots: z.array(z.object({
    keyword: z.string().max(500),
    position: z.number().int().min(1).max(1000),
    url: z.string().url().optional(),
    competitors: z.array(z.object({
      domain: z.string().max(200),
      position: z.number().int().min(1).max(1000),
    })).max(20).optional(),
  })).min(1).max(200),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500)

  const admin = createAdminClient()

  let query = admin
    .from('scp_gsc_performance')
    .select('query, avg_position, clicks, impressions, date')
    .eq('app_id', appId)
    .gte('date', since)
    .order('date', { ascending: false })
    .limit(limit)

  if (keyword) query = query.ilike('query', `%${keyword}%`)

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ snapshots: data ?? [], since })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = snapshotBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Update keywords table with latest position
  const updates = parsed.data.snapshots.map(async (snap) => {
    await admin
      .from('scp_keywords')
      .update({ gsc_position: snap.position, updated_at: new Date().toISOString() })
      .eq('app_id', appId)
      .eq('keyword', snap.keyword)

    // Upsert gsc_performance row
    await admin
      .from('scp_gsc_performance')
      .upsert({
        app_id: appId,
        query: snap.keyword,
        avg_position: snap.position,
        date: today,
      }, { onConflict: 'app_id,query,date' })
  })

  await Promise.all(updates)

  return NextResponse.json({ stored: parsed.data.snapshots.length, date: today })
}
