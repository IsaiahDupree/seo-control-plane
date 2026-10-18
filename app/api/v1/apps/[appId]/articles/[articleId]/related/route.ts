// Related articles — find semantically similar articles for content discovery
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function tokenise(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 3)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : inter.size / union.size
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50)
  const sameCluster = searchParams.get('same_cluster') === 'true'

  const admin = createAdminClient()

  const { data: source, error: srcErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, focus_keyword, cluster_name, tags')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (srcErr) return jsonError(500, 'query_failed', srcErr.message)
  if (!source) return jsonError(404, 'not_found', 'Article not found')

  const srcText = [source.title, source.description, source.focus_keyword].filter(Boolean).join(' ')
  const srcTokens = tokenise(srcText as string)
  const srcCluster = source.cluster_name as string | null

  let query = admin
    .from('scp_articles')
    .select('id, slug, title, description, focus_keyword, cluster_name, published_at, gsc_avg_position')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .neq('id', articleId)
    .limit(500)

  if (sameCluster && srcCluster) query = query.eq('cluster_name', srcCluster)

  const { data: candidates, error: candErr } = await query
  if (candErr) return jsonError(500, 'query_failed', candErr.message)

  const scored = (candidates ?? [])
    .map((c) => {
      const candText = [c.title, c.description, c.focus_keyword].filter(Boolean).join(' ')
      const score = jaccard(srcTokens, tokenise(candText as string))
      const clusterBoost = srcCluster && c.cluster_name === srcCluster ? 0.1 : 0
      return { ...c, relevance: Math.min(1, score + clusterBoost) }
    })
    .filter((c) => c.relevance > 0.05)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map(({ id, slug, title, cluster_name, published_at, gsc_avg_position, relevance }) => ({
      article_id: id,
      slug,
      title,
      cluster_name: cluster_name ?? null,
      published_at,
      avg_position: gsc_avg_position ?? null,
      relevance_score: Math.round(relevance * 100) / 100,
    }))

  return NextResponse.json({ article_id: articleId, related: scored })
}
