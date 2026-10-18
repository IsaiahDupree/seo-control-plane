// Articles associated with a specific keyword
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; keywordId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, keywordId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: keyword, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, cluster_name, article_id')
    .eq('id', keywordId)
    .eq('app_id', appId)
    .maybeSingle()

  if (kwErr) return jsonError(500, 'query_failed', kwErr.message)
  if (!keyword) return jsonError(404, 'not_found', 'Keyword not found')

  // Find articles where this keyword is focus or secondary
  const { data: articles, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, published_at, gsc_clicks, gsc_avg_position, focus_keyword, secondary_keywords')
    .eq('app_id', appId)
    .not('status', 'eq', 'archived')

  if (artErr) return jsonError(500, 'query_failed', artErr.message)

  const kw = keyword.keyword.toLowerCase()
  const matched = (articles ?? []).filter((a) => {
    const fk = (a.focus_keyword as string | null)?.toLowerCase()
    const sk = (a.secondary_keywords as string[]) ?? []
    return fk === kw || sk.some((s) => s.toLowerCase() === kw)
  }).map((a) => ({
    article_id: a.id,
    slug: a.slug,
    title: a.title,
    status: a.status,
    published_at: a.published_at ?? null,
    gsc_clicks: a.gsc_clicks ?? 0,
    gsc_avg_position: a.gsc_avg_position ?? null,
    is_focus_keyword: (a.focus_keyword as string | null)?.toLowerCase() === kw,
  }))

  return NextResponse.json({
    keyword_id: keywordId,
    keyword: keyword.keyword,
    cluster_name: keyword.cluster_name ?? null,
    assigned_article_id: keyword.article_id ?? null,
    articles: matched,
  })
}
