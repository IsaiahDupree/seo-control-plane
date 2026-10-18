// F-CP-036: URL exclusion blacklist — prevents SCP from publishing to or linking these URLs
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const exclusionBody = z.object({
  urls: z.array(z.string().max(2048)).min(1).max(500),
  reason: z.string().max(200).optional(),
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
  const exclusions = (ctx.url_exclusions as string[] | undefined) ?? []

  return NextResponse.json({ url_exclusions: exclusions, count: exclusions.length })
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

  const parsed = exclusionBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
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

  const prevExclusions = parsed.data.replace
    ? []
    : ((prevCtx.url_exclusions as string[] | undefined) ?? [])

  // Deduplicate
  const merged = Array.from(new Set([...prevExclusions, ...parsed.data.urls]))

  if (merged.length > 2000) {
    return jsonError(400, 'too_many', 'Maximum 2000 URL exclusions per app')
  }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({
      context: { ...prevCtx, url_exclusions: merged },
      updated_at: now,
    })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'url_exclusions',
    version: 1,
    snapshot: { added: parsed.data.urls, reason: parsed.data.reason ?? null, replace: parsed.data.replace },
  })

  return NextResponse.json({ url_exclusions: merged, count: merged.length }, { status: 200 })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const url = searchParams.get('url')
  if (!url) return jsonError(400, 'missing_url', 'Provide ?url= to remove from exclusions')

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

  const prevExclusions = (prevCtx.url_exclusions as string[] | undefined) ?? []
  const updated = prevExclusions.filter((u) => u !== url)

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, url_exclusions: updated }, updated_at: now })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({ removed: url, url_exclusions: updated, count: updated.length })
}
