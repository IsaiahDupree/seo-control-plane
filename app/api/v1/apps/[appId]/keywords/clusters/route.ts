import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { z } from 'zod'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

const assignBody = z.object({
  assignments: z.array(z.object({
    keyword_id: z.string().uuid(),
    cluster_name: z.string().min(1).max(200),
  })).min(1).max(500),
})

/** GET /clusters — list distinct clusters with keyword counts */
export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_keywords')
    .select('cluster_name')
    .eq('app_id', appId)
    .not('cluster_name', 'is', null)

  if (error) return jsonError(500, 'query_failed', error.message)

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const name = row.cluster_name as string
    counts[name] = (counts[name] ?? 0) + 1
  }

  const clusters = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ clusters })
}

/** PATCH /clusters — bulk assign keywords to clusters */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = assignBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const results: { id: string; cluster_name: string }[] = []

  for (const item of parsed.data.assignments) {
    const { data, error } = await admin
      .from('scp_keywords')
      .update({ cluster_name: item.cluster_name })
      .eq('id', item.keyword_id)
      .eq('app_id', appId)
      .select('id, cluster_name')
      .single()

    if (!error && data) results.push(data)
  }

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'keyword.clusters_assigned',
    entity_type: 'app',
    entity_id: appId,
    performed_by: null,
    payload: {
      source: 'api_key',
      requested: parsed.data.assignments.length,
      updated: results.length,
      items: results,
    },
  })

  return NextResponse.json({
    updated: results.length,
    items: results,
    ...(audit_warning ? { audit_warning } : {}),
  })
}
