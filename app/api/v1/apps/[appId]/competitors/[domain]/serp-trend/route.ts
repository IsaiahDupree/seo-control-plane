// F-CP-019: Competitor SERP history trend for a specific domain + keyword
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; domain: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, domain } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const keyword = searchParams.get('keyword')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '90', 10), 365)

  const admin = createAdminClient()

  let query = admin
    .from('scp_competitor_serps')
    .select('keyword, rank_position, page_url, page_title, fetched_at')
    .eq('app_id', appId)
    .eq('competitor_domain', domain.toLowerCase())
    .order('fetched_at', { ascending: false })
    .limit(limit)

  if (keyword) query = query.eq('keyword', keyword.toLowerCase().trim())

  const { data, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  // Group by keyword to show trend
  const trendMap = new Map<string, Array<{ date: string; position: number; url: string | null }>>()
  for (const row of data ?? []) {
    const kw = row.keyword
    if (!trendMap.has(kw)) trendMap.set(kw, [])
    trendMap.get(kw)!.push({
      date: (row.fetched_at as string).slice(0, 10),
      position: row.rank_position,
      url: row.page_url ?? null,
    })
  }

  const trends = Array.from(trendMap.entries()).map(([kw, points]) => {
    const sorted = points.sort((a, b) => a.date.localeCompare(b.date))
    const first = sorted[0]?.position ?? null
    const last = sorted[sorted.length - 1]?.position ?? null
    const movement = first !== null && last !== null ? first - last : null // positive = improved

    return {
      keyword: kw,
      current_position: last,
      position_movement: movement,
      direction: movement === null ? null : movement > 0 ? 'improved' : movement < 0 ? 'declined' : 'stable',
      data_points: sorted,
    }
  }).sort((a, b) => (a.current_position ?? 999) - (b.current_position ?? 999))

  return NextResponse.json({
    competitor_domain: domain.toLowerCase(),
    keyword_filter: keyword ?? null,
    trends,
    keywords_tracked: trends.length,
  })
}
