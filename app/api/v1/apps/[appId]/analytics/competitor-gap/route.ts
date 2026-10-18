// Competitor gap analysis — keywords competitors rank for that we don't
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const domain = searchParams.get('domain')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  // Get our tracked keywords and their GSC positions
  const { data: ourKeywords, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, gsc_position, status')
    .eq('app_id', appId)
    .eq('status', 'active')
    .limit(5000)

  if (kwErr) return jsonError(500, 'query_failed', kwErr.message)

  const ourKwMap = new Map(
    (ourKeywords ?? []).map((k) => [k.keyword.toLowerCase(), k.gsc_position as number | null])
  )

  // Get competitor SERP data
  let serpQuery = admin
    .from('scp_competitor_serp')
    .select('keyword_id, domain, position')
    .eq('app_id', appId)
    .lte('position', 20)

  if (domain) serpQuery = serpQuery.eq('domain', domain)

  const { data: serpRows, error: serpErr } = await serpQuery.limit(10000)
  if (serpErr) return jsonError(500, 'query_failed', serpErr.message)

  // Get keyword details for the SERP rows
  const kwIds = [...new Set((serpRows ?? []).map((r) => r.keyword_id as string))]
  const { data: kwDetails } = kwIds.length
    ? await admin.from('scp_keywords').select('id, keyword, search_volume, cluster_name').in('id', kwIds)
    : { data: [] }

  const kwDetailMap = new Map(((kwDetails ?? []) as { id: string; keyword: string; search_volume: number | null; cluster_name: string | null }[]).map((k) => [k.id, k]))

  // Find gaps: competitor ranks in top 20, we don't rank or rank > 20
  const gaps = (serpRows ?? [])
    .map((r) => {
      const kw = kwDetailMap.get(r.keyword_id as string)
      if (!kw) return null
      const ourPos = ourKwMap.get(kw.keyword.toLowerCase())
      const isGap = ourPos === null || ourPos === undefined || ourPos > 20
      return isGap ? {
        keyword_id: r.keyword_id,
        keyword: kw.keyword,
        cluster_name: kw.cluster_name ?? null,
        search_volume: kw.search_volume ?? null,
        competitor_domain: r.domain,
        competitor_position: r.position,
        our_position: ourPos ?? null,
        gap_type: ourPos === null || ourPos === undefined ? 'not_tracked' : 'outranked',
      } : null
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, limit)

  return NextResponse.json({
    domain_filter: domain ?? null,
    total_gaps: gaps.length,
    gaps,
  })
}
