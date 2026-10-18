// F-CP-034: Content pillar hierarchy definition
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const pillarSchema = z.object({
  name: z.string().min(1).max(150),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().max(1000).optional(),
  parent_slug: z.string().max(100).optional(),
  target_articles: z.number().int().min(1).max(500).optional(),
  primary_keywords: z.array(z.string().max(200)).max(20).optional(),
  sort_order: z.number().int().min(0).optional(),
})

const pillarsBody = z.object({
  pillars: z.array(pillarSchema).min(1).max(50),
  replace: z.boolean().default(false),
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
  const pillars = (ctx.content_pillars as unknown[] | undefined) ?? []

  return NextResponse.json({ content_pillars: pillars, count: pillars.length })
}

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

  const parsed = pillarsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  // Validate parent_slug references exist within the submitted set
  const slugSet = new Set(parsed.data.pillars.map((p) => p.slug))
  for (const pillar of parsed.data.pillars) {
    if (pillar.parent_slug && !slugSet.has(pillar.parent_slug)) {
      return jsonError(
        400,
        'invalid_parent_slug',
        `parent_slug "${pillar.parent_slug}" references a pillar not in the submitted set`
      )
    }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('context')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const prevCtx =
    app.context && typeof app.context === 'object' && !Array.isArray(app.context)
      ? (app.context as Record<string, unknown>)
      : {}

  const prevPillars = parsed.data.replace
    ? []
    : ((prevCtx.content_pillars as unknown[] | undefined) ?? [])

  // Merge by slug — new entries override existing
  const pillarMap = new Map<string, unknown>()
  for (const p of prevPillars) {
    const obj = p as Record<string, unknown>
    pillarMap.set(obj.slug as string, p)
  }
  for (const p of parsed.data.pillars) {
    pillarMap.set(p.slug, p)
  }

  const merged = Array.from(pillarMap.values())

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, content_pillars: merged }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  // Version history (F-CP-008)
  const { data: lastLog } = await admin
    .from('scp_app_sync_logs')
    .select('version')
    .eq('app_id', appId)
    .eq('sync_type', 'content_pillars')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (lastLog?.version ?? 0) + 1
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'content_pillars',
    version: nextVersion,
    snapshot: { pillars: parsed.data.pillars, replace: parsed.data.replace },
  })

  return NextResponse.json(
    { content_pillars: merged, count: merged.length, version: nextVersion },
    { status: 200 }
  )
}
