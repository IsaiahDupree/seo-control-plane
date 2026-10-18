import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { processNextRefreshItem } from '@/lib/refresh-queue'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

/** POST — pop and process the next highest-priority refresh queue item */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const result = await processNextRefreshItem(appId)
  if (!result) {
    return NextResponse.json({ ok: true, processed: false, message: 'Queue is empty' })
  }

  const admin = createAdminClient()
  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'refresh.processed',
    entity_type: 'article',
    entity_id: result.article_id,
    performed_by: null,
    payload: {
      source: 'api_key',
      slug: result.slug,
      success: result.success,
      error: result.error ?? null,
    },
  })

  return NextResponse.json({
    ok: true,
    processed: true,
    article_id: result.article_id,
    slug: result.slug,
    success: result.success,
    error: result.error ?? null,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
