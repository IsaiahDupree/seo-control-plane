// Article version history — list and restore previous versions stored in audit log
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

  // Verify article belongs to app
  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, delivery_version')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  // Pull version snapshots from user audit log
  const { data: versions, error: verErr } = await admin
    .from('scp_user_audit_log')
    .select('id, action, payload, performed_at')
    .eq('app_id', appId)
    .eq('entity_id', articleId)
    .eq('entity_type', 'article')
    .order('performed_at', { ascending: false })
    .limit(50)

  if (verErr) return jsonError(500, 'query_failed', verErr.message)

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    current_version: article.delivery_version,
    history: (versions ?? []).map((v) => ({
      audit_id: v.id,
      action: v.action,
      snapshot: v.payload,
      performed_at: v.performed_at,
    })),
  })
}
