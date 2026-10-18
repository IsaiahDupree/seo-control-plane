// Backlink summary — aggregate backlink stats across all articles
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
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100)

  const admin = createAdminClient()

  const { data: backlinks, error } = await admin
    .from('scp_backlinks')
    .select('article_id, source_domain, domain_rating, is_dofollow, first_seen_at')
    .eq('app_id', appId)
    .limit(50000)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = backlinks ?? []
  const totalBacklinks = rows.length
  const dofollowCount = rows.filter((b) => b.is_dofollow).length
  const uniqueDomains = new Set(rows.map((b) => b.source_domain)).size
  const drValues = rows.filter((b) => b.domain_rating !== null).map((b) => b.domain_rating as number)
  const avgDr = drValues.length > 0 ? Math.round(drValues.reduce((s, v) => s + v, 0) / drValues.length) : null

  // Top linking domains
  const domainMap = new Map<string, { count: number; max_dr: number }>()
  for (const b of rows) {
    const d = b.source_domain as string
    if (!domainMap.has(d)) domainMap.set(d, { count: 0, max_dr: 0 })
    const entry = domainMap.get(d)!
    entry.count++
    if ((b.domain_rating as number) > entry.max_dr) entry.max_dr = b.domain_rating as number
  }

  const topDomains = Array.from(domainMap.entries())
    .sort(([, a], [, b]) => b.max_dr - a.max_dr || b.count - a.count)
    .slice(0, limit)
    .map(([domain, data]) => ({ domain, backlink_count: data.count, max_domain_rating: data.max_dr }))

  // Top articles by backlink count
  const artMap = new Map<string, number>()
  for (const b of rows) {
    const id = b.article_id as string
    artMap.set(id, (artMap.get(id) ?? 0) + 1)
  }

  const topArtIds = Array.from(artMap.entries()).sort(([, a], [, b]) => b - a).slice(0, limit).map(([id]) => id)
  const { data: articles } = topArtIds.length
    ? await admin.from('scp_articles').select('id, slug, title').in('id', topArtIds)
    : { data: [] }

  const artLookup = new Map(((articles ?? []) as { id: string; slug: string; title: string }[]).map((a) => [a.id, a]))
  const topArticles = Array.from(artMap.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id, count]) => {
      const art = artLookup.get(id)
      return { article_id: id, slug: art?.slug ?? null, title: art?.title ?? null, backlink_count: count }
    })

  return NextResponse.json({
    total_backlinks: totalBacklinks,
    dofollow_count: dofollowCount,
    nofollow_count: totalBacklinks - dofollowCount,
    unique_linking_domains: uniqueDomains,
    avg_domain_rating: avgDr,
    top_linking_domains: topDomains,
    top_linked_articles: topArticles,
  })
}
