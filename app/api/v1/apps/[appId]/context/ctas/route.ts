// F-CP-004: App CTA library sync
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const ctaSchema = z.object({
  id: z.string().max(100).optional(),
  label: z.string().min(1).max(200),
  url: z.string().url(),
  trigger_phrase: z.string().max(300).optional(),
  placement: z.enum(['inline', 'end', 'sidebar', 'popup']).optional(),
  funnel_stage: z.enum(['awareness', 'consideration', 'conversion']).optional(),
  is_active: z.boolean().default(true),
})

const ctasBody = z.object({
  ctas: z.array(ctaSchema).min(1).max(50),
  replace: z.boolean().default(false),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_app_ctas')
    .select('*')
    .eq('app_id', appId)
    .order('created_at', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ ctas: data ?? [] })
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

  const parsed = ctasBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (parsed.data.replace) {
    await admin.from('scp_app_ctas').delete().eq('app_id', appId)
  }

  const rows = parsed.data.ctas.map((c) => ({
    app_id: appId,
    external_id: c.id ?? null,
    label: c.label,
    url: c.url,
    trigger_phrase: c.trigger_phrase ?? null,
    placement: c.placement ?? null,
    funnel_stage: c.funnel_stage ?? null,
    is_active: c.is_active,
    updated_at: now,
  }))

  // Upsert on (app_id, external_id) when external_id provided, else insert
  const withId = rows.filter((r) => r.external_id !== null)
  const withoutId = rows.filter((r) => r.external_id === null)

  let upserted: unknown[] = []
  let inserted: unknown[] = []

  if (withId.length > 0) {
    const { data, error } = await admin
      .from('scp_app_ctas')
      .upsert(withId, { onConflict: 'app_id,external_id' })
      .select('*')
    if (error) return jsonError(500, 'upsert_failed', error.message)
    upserted = data ?? []
  }

  if (withoutId.length > 0) {
    const { data, error } = await admin
      .from('scp_app_ctas')
      .insert(withoutId)
      .select('*')
    if (error) return jsonError(500, 'insert_failed', error.message)
    inserted = data ?? []
  }

  // Version history (F-CP-008)
  const { data: lastLog } = await admin
    .from('scp_app_sync_logs')
    .select('version')
    .eq('app_id', appId)
    .eq('sync_type', 'ctas')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (lastLog?.version ?? 0) + 1
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'ctas',
    version: nextVersion,
    snapshot: { ctas: parsed.data.ctas, replace: parsed.data.replace },
  })

  const all = [...upserted, ...inserted]
  return NextResponse.json({ ctas: all, count: all.length, version: nextVersion }, { status: 200 })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { error } = await admin.from('scp_app_ctas').delete().eq('app_id', appId)
  if (error) return jsonError(500, 'delete_failed', error.message)

  return NextResponse.json({ deleted: true })
}
