// Cron: auto-publish articles from the publish queue within the configured publish window
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid cron secret' } }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date()
  const nowIso = now.toISOString()

  // Pull due items from publish queue
  const { data: dueItems, error: qErr } = await admin
    .from('scp_publish_queue')
    .select('id, article_id, app_id, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(20)

  if (qErr) {
    return NextResponse.json({ error: { code: 'query_failed', message: qErr.message } }, { status: 500 })
  }

  const items = dueItems ?? []
  const published: string[] = []
  const skipped: string[] = []

  for (const item of items) {
    const appId = item.app_id as string | null
    const articleId = item.article_id as string

    // Check publish window config on the app
    if (appId) {
      const { data: app } = await admin
        .from('scp_apps')
        .select('context, status')
        .eq('id', appId)
        .maybeSingle()

      if (!app || app.status !== 'active') {
        skipped.push(item.id as string)
        continue
      }

      const ctx = (app.context && typeof app.context === 'object' ? app.context : {}) as Record<string, unknown>
      const pw = ctx.publish_window as Record<string, unknown> | null | undefined
      if (pw) {
        const tz = (pw.timezone as string | null) ?? 'UTC'
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz }).toLowerCase()
        const dayConfig = pw[dayName] as { enabled?: boolean; start_hour?: number; end_hour?: number } | null | undefined
        const currentHour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: tz }), 10)

        if (dayConfig && dayConfig.enabled === false) {
          skipped.push(item.id as string)
          continue
        }
        if (dayConfig?.start_hour !== undefined && currentHour < dayConfig.start_hour) {
          skipped.push(item.id as string)
          continue
        }
        if (dayConfig?.end_hour !== undefined && currentHour >= dayConfig.end_hour) {
          skipped.push(item.id as string)
          continue
        }
      }
    }

    // Mark article as published and queue item as delivered
    const [, qUpdate] = await Promise.all([
      admin
        .from('scp_articles')
        .update({ status: 'published', published_at: nowIso, updated_at: nowIso })
        .eq('id', articleId),
      admin
        .from('scp_publish_queue')
        .update({ status: 'delivered', updated_at: nowIso })
        .eq('id', item.id),
    ])

    if (!qUpdate.error) {
      published.push(articleId)
      // Insert publish log
      await admin.from('scp_publish_logs').insert({
        app_id: appId,
        article_id: articleId,
        event_type: 'published',
        occurred_at: nowIso,
      })
    }
  }

  return NextResponse.json({
    processed: items.length,
    published: published.length,
    skipped: skipped.length,
    published_article_ids: published,
    run_at: nowIso,
  })
}
