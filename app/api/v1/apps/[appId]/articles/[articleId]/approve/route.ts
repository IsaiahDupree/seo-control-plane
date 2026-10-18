// F-CP-067: Article publish approval workflow
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const approvalBody = z.object({
  action: z.enum(['approve', 'reject', 'request_changes']),
  notes: z.string().max(2000).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = approvalBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, status')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const ALLOWED_INITIAL_STATUSES = ['draft', 'pending_approval', 'changes_requested']
  if (!ALLOWED_INITIAL_STATUSES.includes(article.status as string)) {
    return jsonError(409, 'invalid_status', `Cannot approve/reject article with status "${article.status}"`)
  }

  const statusMap: Record<string, string> = {
    approve: 'approved',
    reject: 'rejected',
    request_changes: 'changes_requested',
  }

  const newStatus = statusMap[parsed.data.action]
  const now = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('scp_articles')
    .update({ status: newStatus, updated_at: now })
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: `article.${parsed.data.action}d`,
    entity_type: 'article',
    entity_id: articleId,
    performed_by: null,
    payload: { notes: parsed.data.notes ?? null, previous_status: article.status, new_status: newStatus },
  })

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    action: parsed.data.action,
    previous_status: article.status,
    new_status: newStatus,
    updated_at: now,
  })
}
