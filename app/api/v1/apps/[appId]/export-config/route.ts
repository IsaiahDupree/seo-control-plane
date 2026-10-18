// Export app configuration — context, keywords, and settings as JSON
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const includeKeywords = searchParams.get('include_keywords') !== 'false'
  const includeArticleMeta = searchParams.get('include_article_meta') === 'true'

  const admin = createAdminClient()

  const [appResult, kwResult, artResult] = await Promise.all([
    admin.from('scp_apps').select('id, name, domain, status, context, settings, created_at').eq('id', appId).maybeSingle(),
    includeKeywords
      ? admin.from('scp_keywords').select('keyword, cluster_name, intent_type, search_volume, status').eq('app_id', appId).limit(5000)
      : { data: [], error: null },
    includeArticleMeta
      ? admin.from('scp_articles').select('slug, title, focus_keyword, cluster_name, status, published_at').eq('app_id', appId).not('status', 'eq', 'archived').limit(2000)
      : { data: [], error: null },
  ])

  if (appResult.error) return jsonError(500, 'query_failed', appResult.error.message)
  if (!appResult.data) return jsonError(404, 'not_found', 'App not found')

  const exportPayload = {
    export_version: '1.0',
    exported_at: new Date().toISOString(),
    app: {
      id: appResult.data.id,
      name: appResult.data.name,
      domain: appResult.data.domain,
      status: appResult.data.status,
      context: appResult.data.context,
      settings: appResult.data.settings,
      created_at: appResult.data.created_at,
    },
    keywords: includeKeywords ? (kwResult.data ?? []) : [],
    article_meta: includeArticleMeta ? (artResult.data ?? []) : [],
  }

  return NextResponse.json(exportPayload)
}
