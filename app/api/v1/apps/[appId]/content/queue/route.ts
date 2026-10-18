import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10) || 25))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const full = sp.get('full') === '1' || sp.get('full') === 'true'

  const admin = createAdminClient()
  const columns = full
    ? 'id, slug, title, description, status, scheduled_publish_at, published_at, meta_json, meta_title, meta_description, body_mdx, content_html, content_markdown, focus_keyword, secondary_keywords, content_type, cluster_name, word_count, reading_time_minutes, schema_json, tags, qa_score, updated_at'
    : 'id, slug, title, description, status, scheduled_publish_at, meta_json, updated_at'

  const { data, error } = await admin
    .from('scp_articles')
    .select(columns)
    .eq('app_id', appId)
    .in('status', ['approved', 'queued'])
    .order('scheduled_publish_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }

  const items = data ?? []
  return NextResponse.json({
    items,
    limit,
    offset,
    has_more: items.length === limit,
  })
}
