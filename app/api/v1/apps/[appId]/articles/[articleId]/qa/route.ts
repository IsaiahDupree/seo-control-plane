import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const qaColumns =
  'id, article_id, app_id, overall_score, quality_score, seo_score, readability_score, checks_passed, checks_failed, blocking_issues, warnings, outcome, reviewed_by, reviewed_at, created_at'

/** Latest (or full history) QA report rows for an article. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const all = request.nextUrl.searchParams.get('all') === '1' || request.nextUrl.searchParams.get('all') === 'true'
  const limit = all
    ? Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10) || 20))
    : 1

  const admin = createAdminClient()
  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const { data: rows, error } = await admin
    .from('scp_qa_reports')
    .select(qaColumns)
    .eq('article_id', articleId)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return jsonError(500, 'query_failed', error.message)
  }

  const list = rows ?? []
  if (!all) {
    return NextResponse.json({ report: list[0] ?? null })
  }
  return NextResponse.json({ reports: list })
}
