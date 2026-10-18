// Internal link suggestions: given an article, suggest relevant published articles to link to
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const articleId = searchParams.get('article_id')
  const keyword = searchParams.get('keyword')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50)

  if (!articleId && !keyword) {
    return jsonError(400, 'missing_params', 'Provide article_id or keyword query param')
  }

  const admin = createAdminClient()

  // Fetch source article (if article_id provided)
  let sourceTokens: Set<string> = new Set()
  let sourceId: string | null = null
  let sourceFocusKeyword: string | null = null
  let sourceCluster: string | null = null

  if (articleId) {
    const { data: source, error } = await admin
      .from('scp_articles')
      .select('id, title, description, body_mdx, focus_keyword, cluster_name')
      .eq('id', articleId)
      .eq('app_id', appId)
      .maybeSingle()

    if (error) return jsonError(500, 'query_failed', error.message)
    if (!source) return jsonError(404, 'not_found', 'Article not found')

    sourceId = source.id
    sourceFocusKeyword = source.focus_keyword as string | null
    sourceCluster = source.cluster_name as string | null
    const sourceText = [source.title, source.description, source.focus_keyword].filter(Boolean).join(' ')
    sourceTokens = tokenise(sourceText)
  } else if (keyword) {
    sourceFocusKeyword = keyword
    sourceTokens = tokenise(keyword)
  }

  // Fetch candidate published articles
  const { data: candidates, error: candErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, focus_keyword, cluster_name, published_at, gsc_avg_position')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .neq('id', sourceId ?? '')
    .limit(500)

  if (candErr) return jsonError(500, 'query_failed', candErr.message)

  // Score each candidate
  const scored = (candidates ?? []).map((c) => {
    const candText = [c.title, c.description, c.focus_keyword].filter(Boolean).join(' ')
    const candTokens = tokenise(candText as string)
    const similarity = jaccardSimilarity(sourceTokens, candTokens)

    // Boost same-cluster articles
    const clusterBoost = sourceCluster && c.cluster_name === sourceCluster ? 0.15 : 0
    // Boost articles with good GSC position (lower = better)
    const positionBoost = c.gsc_avg_position !== null && (c.gsc_avg_position as number) <= 10 ? 0.1 : 0

    const score = Math.min(1, similarity + clusterBoost + positionBoost)

    return {
      article_id: c.id,
      slug: c.slug,
      title: c.title,
      focus_keyword: c.focus_keyword ?? null,
      cluster_name: c.cluster_name ?? null,
      published_at: c.published_at,
      avg_position: c.gsc_avg_position ?? null,
      relevance_score: Math.round(score * 100) / 100,
      same_cluster: sourceCluster ? c.cluster_name === sourceCluster : false,
    }
  })
  .filter((c) => c.relevance_score > 0.05)
  .sort((a, b) => b.relevance_score - a.relevance_score)
  .slice(0, limit)

  return NextResponse.json({
    source_article_id: sourceId,
    source_keyword: sourceFocusKeyword,
    suggestions: scored,
    total_candidates_evaluated: (candidates ?? []).length,
  })
}
