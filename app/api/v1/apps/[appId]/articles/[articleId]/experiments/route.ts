import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { evaluateExperiment } from '@/lib/experiments'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

/** GET — list experiments for an article */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const db = createAdminClient()
  const { data, error } = await db
    .from('scp_experiments')
    .select('*')
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .order('created_at', { ascending: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  // Enrich with live stats
  const enriched = (data ?? []).map((exp) => ({
    ...exp,
    stats: evaluateExperiment({
      control_conversions: exp.control_conversions as number,
      variant_conversions: exp.variant_conversions as number,
      control_sessions: exp.control_sessions as number,
      variant_sessions: exp.variant_sessions as number,
    }),
  }))

  return NextResponse.json({ experiments: enriched })
}

const createSchema = z.object({
  variant_type: z.enum(['title', 'meta_description', 'cta_text', 'cta_position', 'h2_heading', 'intro_paragraph']),
  control_value: z.string().min(1),
  variant_value: z.string().min(1),
})

/** POST — create a new experiment on an article */
export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = createSchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const db = createAdminClient()

  // Verify article belongs to this app
  const { data: art } = await db
    .from('scp_articles')
    .select('id')
    .eq('id', articleId)
    .eq('app_id', appId)
    .single()
  if (!art) return jsonError(404, 'not_found', 'Article not found')

  // Only one running experiment per variant_type per article
  const { data: existing } = await db
    .from('scp_experiments')
    .select('id')
    .eq('article_id', articleId)
    .eq('variant_type', parsed.data.variant_type)
    .eq('status', 'running')
    .maybeSingle()

  if (existing) return jsonError(409, 'conflict', `A running experiment for ${parsed.data.variant_type} already exists`)

  const { data, error } = await db
    .from('scp_experiments')
    .insert({
      app_id: appId,
      article_id: articleId,
      variant_type: parsed.data.variant_type,
      control_value: parsed.data.control_value,
      variant_value: parsed.data.variant_value,
      status: 'running',
    })
    .select('*')
    .single()

  if (error || !data) return jsonError(500, 'insert_failed', error?.message ?? 'Failed to create experiment')

  const audit_warning = await tryInsertUserAudit(db, {
    app_id: appId,
    action: 'experiment.created',
    entity_type: 'experiment',
    entity_id: data.id as string,
    performed_by: null,
    payload: {
      source: 'api_key',
      article_id: articleId,
      variant_type: parsed.data.variant_type,
      control_value: parsed.data.control_value,
      variant_value: parsed.data.variant_value,
    },
  })

  return NextResponse.json(
    {
      experiment: data,
      ...(audit_warning ? { audit_warning } : {}),
    },
    { status: 201 }
  )
}
