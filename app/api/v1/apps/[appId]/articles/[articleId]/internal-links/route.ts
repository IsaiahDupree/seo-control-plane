// Internal links for a specific article — get incoming and outgoing links
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const [outResult, inResult] = await Promise.all([
    admin
      .from('scp_internal_link_edges')
      .select('id, to_article_id, to_slug, anchor_text, position_in_article, is_pillar_link, semantic_score, inserted_by, created_at')
      .eq('app_id', appId)
      .eq('from_article_id', articleId)
      .order('created_at', { ascending: false }),
    admin
      .from('scp_internal_link_edges')
      .select('id, from_article_id, anchor_text, position_in_article, is_pillar_link, semantic_score, inserted_by, created_at')
      .eq('app_id', appId)
      .eq('to_article_id', articleId)
      .order('created_at', { ascending: false }),
  ])

  if (outResult.error) return jsonError(500, 'query_failed', outResult.error.message)

  // Enrich outgoing with target article slugs/titles
  const toIds = (outResult.data ?? []).map((e) => e.to_article_id as string | null).filter((id): id is string => id !== null)
  const fromIds = (inResult.data ?? []).map((e) => e.from_article_id as string).filter(Boolean)

  const [toArts, fromArts] = await Promise.all([
    toIds.length ? admin.from('scp_articles').select('id, slug, title').in('id', toIds) : { data: [] },
    fromIds.length ? admin.from('scp_articles').select('id, slug, title').in('id', fromIds) : { data: [] },
  ])

  const toMap = new Map(((toArts.data ?? []) as { id: string; slug: string; title: string }[]).map((a) => [a.id, a]))
  const fromMap = new Map(((fromArts.data ?? []) as { id: string; slug: string; title: string }[]).map((a) => [a.id, a]))

  const outgoing = (outResult.data ?? []).map((e) => {
    const target = e.to_article_id ? toMap.get(e.to_article_id as string) : null
    return {
      edge_id: e.id,
      to_article_id: e.to_article_id,
      to_slug: target?.slug ?? e.to_slug,
      to_title: target?.title ?? null,
      anchor_text: e.anchor_text,
      position_in_article: e.position_in_article,
      is_pillar_link: e.is_pillar_link,
      semantic_score: e.semantic_score,
      inserted_by: e.inserted_by,
      created_at: e.created_at,
    }
  })

  const incoming = (inResult.data ?? []).map((e) => {
    const source = fromMap.get(e.from_article_id as string)
    return {
      edge_id: e.id,
      from_article_id: e.from_article_id,
      from_slug: source?.slug ?? null,
      from_title: source?.title ?? null,
      anchor_text: e.anchor_text,
      position_in_article: e.position_in_article,
      is_pillar_link: e.is_pillar_link,
      semantic_score: e.semantic_score,
      inserted_by: e.inserted_by,
      created_at: e.created_at,
    }
  })

  return NextResponse.json({
    article_id: articleId,
    outgoing_count: outgoing.length,
    incoming_count: incoming.length,
    outgoing,
    incoming,
  })
}
