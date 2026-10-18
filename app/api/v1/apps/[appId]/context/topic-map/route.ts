// Topic map configuration — structured cluster hierarchy and pillar definitions
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const topicMapBody = z.object({
  pillars: z.array(z.object({
    name: z.string().max(200),
    description: z.string().max(1000).optional(),
    clusters: z.array(z.string().max(200)).max(20),
    pillar_article_slug: z.string().max(300).optional(),
  })).max(20),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!app) return jsonError(404, 'not_found', 'App not found')

  const ctx = (app.context && typeof app.context === 'object' ? app.context : {}) as Record<string, unknown>
  const topicMap = (ctx.topic_map ?? { pillars: [] }) as Record<string, unknown>

  // Enrich with live cluster stats
  const { data: kwClusters } = await admin
    .from('scp_keywords')
    .select('cluster_name, status')
    .eq('app_id', appId)
    .not('cluster_name', 'is', null)

  const clusterCounts = new Map<string, number>()
  for (const k of kwClusters ?? []) {
    if (k.status === 'active') {
      const c = k.cluster_name as string
      clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1)
    }
  }

  return NextResponse.json({ topic_map: topicMap, cluster_keyword_counts: Object.fromEntries(clusterCounts) })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = topicMapBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx = (app.context && typeof app.context === 'object' && !Array.isArray(app.context))
    ? (app.context as Record<string, unknown>)
    : {}

  const { error } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, topic_map: parsed.data }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ topic_map: parsed.data })
}
