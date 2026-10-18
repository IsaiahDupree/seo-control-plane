// Promote article status through the workflow pipeline
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['brief_ready', 'generating'],
  brief_ready: ['generating', 'draft'],
  generating: ['qa_pending', 'draft'],
  qa_pending: ['approved', 'rejected'],
  rejected: ['draft', 'brief_ready'],
  approved: ['scheduled', 'published'],
  scheduled: ['published', 'approved'],
}

const promoteBody = z.object({
  to_status: z.string().max(50),
  note: z.string().max(500).optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = promoteBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, status')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const currentStatus = article.status as string
  const toStatus = parsed.data.to_status
  const allowed = VALID_TRANSITIONS[currentStatus] ?? []

  if (!allowed.includes(toStatus)) {
    return jsonError(400, 'invalid_transition', `Cannot transition from '${currentStatus}' to '${toStatus}'. Allowed: ${allowed.join(', ')}`)
  }

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('scp_articles')
    .update({ status: toStatus, updated_at: now })
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'article_status_change',
    entity_type: 'article',
    entity_id: articleId,
    performed_by: null,
    payload: { from: currentStatus, to: toStatus, note: parsed.data.note ?? null },
  })

  return NextResponse.json({
    article_id: articleId,
    from_status: currentStatus,
    to_status: toStatus,
    transitioned_at: now,
  })
}
