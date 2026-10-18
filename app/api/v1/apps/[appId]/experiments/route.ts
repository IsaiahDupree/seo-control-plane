import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { createExperimentBody } from '@/lib/schemas'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const experimentColumns =
  'id, article_id, variant_type, control_value, variant_value, status, winner, started_at, concluded_at, control_conversions, variant_conversions, control_sessions, variant_sessions, significance_pct, created_at'

/** List A/B experiments for this app. */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const sp = request.nextUrl.searchParams
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '40', 10) || 40))
  const offset = Math.max(0, parseInt(sp.get('offset') ?? '0', 10) || 0)
  const articleId = sp.get('article_id')
  const status = sp.get('status')

  const admin = createAdminClient()
  let q = admin
    .from('scp_experiments')
    .select(experimentColumns)
    .eq('app_id', appId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (articleId) q = q.eq('article_id', articleId)
  if (status) q = q.eq('status', status)

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

/** Create a new experiment (status `running`). */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = createExperimentBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: art, error: artErr } = await admin
    .from('scp_articles')
    .select('id')
    .eq('id', parsed.data.article_id)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!art) {
    return jsonError(404, 'article_not_found', 'Article not found for this app')
  }

  const { data: row, error } = await admin
    .from('scp_experiments')
    .insert({
      app_id: appId,
      article_id: parsed.data.article_id,
      variant_type: parsed.data.variant_type,
      control_value: parsed.data.control_value,
      variant_value: parsed.data.variant_value,
      status: 'running',
    })
    .select(experimentColumns)
    .single()

  if (error) return jsonError(500, 'insert_failed', error.message)

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'experiment.created',
    entity_type: 'experiment',
    entity_id: row.id,
    performed_by: null,
    payload: {
      source: 'api_key',
      article_id: parsed.data.article_id,
      variant_type: parsed.data.variant_type,
      control_value: parsed.data.control_value,
      variant_value: parsed.data.variant_value,
    },
  })

  return NextResponse.json({
    experiment: row,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
