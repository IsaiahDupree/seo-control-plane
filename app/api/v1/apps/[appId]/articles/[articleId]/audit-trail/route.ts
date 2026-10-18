// Article audit trail — all audit log entries for a specific article
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const action = searchParams.get('action')

  const admin = createAdminClient()

  // Verify article belongs to app
  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  let query = admin
    .from('scp_user_audit_log')
    .select('id, action, entity_type, entity_id, performed_by, payload, performed_at')
    .eq('app_id', appId)
    .eq('entity_id', articleId)
    .order('performed_at', { ascending: false })
    .limit(limit)

  if (action) query = query.eq('action', action)

  const { data: entries, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    title: article.title,
    total: entries?.length ?? 0,
    entries: entries ?? [],
  })
}
