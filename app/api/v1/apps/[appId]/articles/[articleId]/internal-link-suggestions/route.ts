// Internal link suggestions for a specific article — ranked by relevance
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

  const admin = createAdminClient()

  const { data: source, error: srcErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, focus_keyword, cluster_name, body_mdx')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (srcErr) return jsonError(500, 'query_failed', srcErr.message)
  if (!source) return jsonError(404, 'not_found', 'Article not found')

  const srcText = [source.title, source.description, source.focus_keyword].filter(Boolean).join(' ')
  const srcTokens = tokenise(srcText as string)
  const srcCluster = source.cluster_name as string | null

  const { data: candidates, error: candErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, focus_keyword, cluster_name')
    .eq('app_id', appId)
    .in('status', ['published', 'indexed', 'ranked'])
    .neq('id', articleId)
    .limit(500)

  if (candErr) return jsonError(500, 'query_failed', candErr.message)

  // Check which articles already link from source
  const { data: existingLinks } = await admin
    .from('scp_internal_link_edges')
    .select('to_article_id')
    .eq('app_id', appId)
    .eq('from_article_id', articleId)

  const alreadyLinked = new Set((existingLinks ?? []).map((l) => l.to_article_id as string).filter(Boolean))

  const scored = (candidates ?? [])
    .filter((c) => !alreadyLinked.has(c.id as string))
    .map((c) => {
      const candText = [c.title, c.description, c.focus_keyword].filter(Boolean).join(' ')
      const sim = jaccard(srcTokens, tokenise(candText as string))
      const clusterBoost = srcCluster && c.cluster_name === srcCluster ? 0.15 : 0
      const score = Math.min(1, sim + clusterBoost)
      return {
        article_id: c.id,
        slug: c.slug,
        title: c.title,
        focus_keyword: c.focus_keyword ?? null,
        cluster_name: c.cluster_name ?? null,
        suggested_anchor: c.focus_keyword ?? c.title,
        relevance_score: Math.round(score * 100) / 100,
        same_cluster: srcCluster ? c.cluster_name === srcCluster : false,
        already_linked: false,
      }
    })
    .filter((c) => c.relevance_score > 0.05)
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, limit)

  return NextResponse.json({
    article_id: articleId,
    existing_outbound_links: alreadyLinked.size,
    suggestions: scored,
  })
}
