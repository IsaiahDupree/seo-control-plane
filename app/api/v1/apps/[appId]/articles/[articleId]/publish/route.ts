// Publish / unpublish a specific article directly (bypass queue)
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const publishBody = z.object({
  action: z.enum(['publish', 'unpublish', 'schedule']),
  scheduled_publish_at: z.string().datetime().optional(),
  canonical_url: z.string().url().optional(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = publishBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, app_id')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  let updatePayload: Record<string, unknown>

  if (parsed.data.action === 'publish') {
    updatePayload = {
      status: 'published',
      published_at: now,
      updated_at: now,
      ...(parsed.data.canonical_url ? { canonical_url: parsed.data.canonical_url } : {}),
    }
  } else if (parsed.data.action === 'unpublish') {
    updatePayload = { status: 'draft', published_at: null, updated_at: now }
  } else {
    if (!parsed.data.scheduled_publish_at) {
      return jsonError(400, 'missing_field', 'scheduled_publish_at required for schedule action')
    }
    updatePayload = {
      status: 'draft',
      scheduled_publish_at: parsed.data.scheduled_publish_at,
      updated_at: now,
    }
  }

  const { error: updateErr } = await admin
    .from('scp_articles')
    .update(updatePayload)
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  // Insert publish log
  if (parsed.data.action !== 'schedule') {
    await admin.from('scp_publish_logs').insert({
      app_id: appId,
      article_id: articleId,
      event_type: parsed.data.action === 'publish' ? 'published' : 'unpublished',
      occurred_at: now,
    })
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: `article_${parsed.data.action}`,
    entity_type: 'article',
    entity_id: articleId,
    performed_by: null,
    payload: { action: parsed.data.action, slug: article.slug },
  })

  return NextResponse.json({
    article_id: articleId,
    action: parsed.data.action,
    status: updatePayload.status,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
