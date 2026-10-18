// Keyword cannibalization report — articles competing for the same keyword
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  const admin = createAdminClient()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, focus_keyword, secondary_keywords, status, gsc_avg_position, gsc_clicks')
    .eq('app_id', appId)
    .not('status', 'eq', 'archived')
    .not('focus_keyword', 'is', null)

  if (error) return jsonError(500, 'query_failed', error.message)

  // Build keyword → articles map
  const kwMap = new Map<string, Array<{ id: string; slug: string; title: string; status: string; gsc_avg_position: number | null; gsc_clicks: number | null; match_type: string }>>()

  for (const a of articles ?? []) {
    const fk = (a.focus_keyword as string).toLowerCase().trim()
    if (!kwMap.has(fk)) kwMap.set(fk, [])
    kwMap.get(fk)!.push({
      id: a.id as string,
      slug: a.slug as string,
      title: a.title as string,
      status: a.status as string,
      gsc_avg_position: a.gsc_avg_position as number | null,
      gsc_clicks: a.gsc_clicks as number | null,
      match_type: 'focus',
    })

    // Check secondary keywords
    for (const sk of (a.secondary_keywords as string[]) ?? []) {
      const skl = sk.toLowerCase().trim()
      if (!kwMap.has(skl)) kwMap.set(skl, [])
      const existing = kwMap.get(skl)!
      if (!existing.find((e) => e.id === a.id as string)) {
        existing.push({
          id: a.id as string,
          slug: a.slug as string,
          title: a.title as string,
          status: a.status as string,
          gsc_avg_position: a.gsc_avg_position as number | null,
          gsc_clicks: a.gsc_clicks as number | null,
          match_type: 'secondary',
        })
      }
    }
  }

  const conflicts = Array.from(kwMap.entries())
    .filter(([, arts]) => arts.length > 1)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, limit)
    .map(([keyword, arts]) => ({
      keyword,
      competing_articles: arts.length,
      articles: arts,
      recommendation: 'Consider consolidating or using canonical URLs to resolve competition',
    }))

  return NextResponse.json({
    total_cannibalized_keywords: conflicts.length,
    conflicts,
  })
}
