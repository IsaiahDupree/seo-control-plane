// Bulk archive articles by IDs, status filter, or cluster
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const bulkArchiveBody = z.object({
  article_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
  cluster_name: z.string().max(200).optional(),
  status_filter: z.enum(['draft', 'rejected', 'expired']).optional(),
  reason: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = bulkArchiveBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  if (!parsed.data.article_ids && !parsed.data.cluster_name && !parsed.data.status_filter) {
    return jsonError(400, 'missing_filter', 'Provide at least one of: article_ids, cluster_name, status_filter')
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  let query = admin
    .from('scp_articles')
    .update({ status: 'archived', updated_at: now })
    .eq('app_id', appId)
    .neq('status', 'archived') // idempotent

  if (parsed.data.article_ids) {
    query = query.in('id', parsed.data.article_ids)
  } else {
    if (parsed.data.cluster_name) query = query.eq('cluster_name', parsed.data.cluster_name)
    if (parsed.data.status_filter) query = query.eq('status', parsed.data.status_filter)
  }

  const { data: archived, error } = await query.select('id')
  const count = archived?.length ?? 0

  if (error) return jsonError(500, 'update_failed', error.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'bulk_archive',
    entity_type: 'article',
    entity_id: appId,
    performed_by: null,
    payload: {
      count: count ?? 0,
      reason: parsed.data.reason ?? null,
      filters: {
        article_ids: parsed.data.article_ids ?? null,
        cluster_name: parsed.data.cluster_name ?? null,
        status_filter: parsed.data.status_filter ?? null,
      },
    },
  })

  return NextResponse.json({ archived_count: count ?? 0, archived_at: now })
}
