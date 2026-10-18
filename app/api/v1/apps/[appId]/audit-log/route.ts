import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

/**
 * API-key and operator actions (`scp_user_audit_log`).
 * Examples: `app.registered` (from POST /api/apps/register), `app.settings_updated`,
 * `keyword.patch`, `keyword.clusters_assigned`,
 * `article.patch`, `brief.patch`, `api_key.created`, `api_key.revoked`,
 * `content_request.cancelled`, `content_request.notes_updated`, `content_request.created`,
 * `content_request.allocated`, `content.schedule`, `article.published`,
 * `article.internal_links_injected`, `article.delivered`, `delivery.retried`,
 * `article_performance.sync`, `keywords.bulk_upsert`, `keywords.gsc_sync`,
 * `indexnow.submitted`, `refresh.enqueue_manual`, `refresh.enqueue_auto`, `refresh.processed`,
 * `article.generated`, `briefs.process_pending`,
 * `experiment.created`, `experiment.patch`, `experiment.concluded`.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const action = sp.get('action')
  const entityType = sp.get('entity_type')

  const admin = createAdminClient()
  let q = admin
    .from('scp_user_audit_log')
    .select('id, action, entity_type, entity_id, performed_by, performed_at, payload')
    .eq('app_id', appId)
    .order('performed_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (action) q = q.eq('action', action)
  if (entityType) q = q.eq('entity_type', entityType)

  const { data, error } = await q

  if (error) return jsonError(500, 'query_failed', error.message)

  const items = data ?? []
  return NextResponse.json({
    items,
    limit,
    offset,
    has_more: items.length === limit,
  })
}
