// Competitor SERP positions for a specific keyword
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; keywordId: string }> }

const serpBody = z.object({
  serp_results: z.array(z.object({
    domain: z.string().max(300),
    url: z.string().url(),
    position: z.number().int().min(1).max(100),
    title: z.string().max(500).optional(),
  })).min(1).max(20),
  captured_at: z.string().datetime().optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, keywordId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: keyword, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, gsc_position')
    .eq('id', keywordId)
    .eq('app_id', appId)
    .maybeSingle()

  if (kwErr) return jsonError(500, 'query_failed', kwErr.message)
  if (!keyword) return jsonError(404, 'not_found', 'Keyword not found')

  const { data: serpRows, error } = await admin
    .from('scp_competitor_serp')
    .select('domain, url, title, position, captured_at')
    .eq('app_id', appId)
    .eq('keyword_id', keywordId)
    .order('position', { ascending: true })
    .limit(20)

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({
    keyword_id: keywordId,
    keyword: keyword.keyword,
    our_position: keyword.gsc_position ?? null,
    serp_results: serpRows ?? [],
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, keywordId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = serpBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = parsed.data.captured_at ?? new Date().toISOString()

  const rows = parsed.data.serp_results.map((r) => ({
    app_id: appId,
    keyword_id: keywordId,
    domain: r.domain,
    url: r.url,
    title: r.title ?? null,
    position: r.position,
    captured_at: now,
  }))

  const { error } = await admin
    .from('scp_competitor_serp')
    .upsert(rows, { onConflict: 'app_id,keyword_id,domain' })

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ keyword_id: keywordId, stored: rows.length, captured_at: now }, { status: 201 })
}
