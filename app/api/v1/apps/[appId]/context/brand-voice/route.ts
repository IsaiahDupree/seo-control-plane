// F-CP-029: Brand voice configuration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const brandVoiceBody = z.object({
  tone: z.enum(['professional', 'conversational', 'technical', 'friendly', 'authoritative', 'playful']).optional(),
  formality: z.enum(['formal', 'semi-formal', 'casual']).optional(),
  use_first_person_plural: z.boolean().optional(),
  avoid_words: z.array(z.string().max(100)).max(100).optional(),
  prefer_words: z.array(z.string().max(100)).max(100).optional(),
  example_content_urls: z.array(z.string().url()).max(10).optional(),
  custom_instructions: z.string().max(2000).optional(),
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
  return NextResponse.json({ brand_voice: ctx.brand_voice ?? null })
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

  const parsed = brandVoiceBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Fetch current context to merge
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

  const prevBrandVoice =
    prevCtx.brand_voice && typeof prevCtx.brand_voice === 'object'
      ? (prevCtx.brand_voice as Record<string, unknown>)
      : {}

  const updatedBrandVoice = { ...prevBrandVoice, ...parsed.data }

  const { error: updateErr } = await admin
    .from('scp_apps')
    .update({
      context: { ...prevCtx, brand_voice: updatedBrandVoice },
      updated_at: now,
    })
    .eq('id', appId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  // Version history (F-CP-008)
  const { data: lastLog } = await admin
    .from('scp_app_sync_logs')
    .select('version')
    .eq('app_id', appId)
    .eq('sync_type', 'brand_voice')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (lastLog?.version ?? 0) + 1
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'brand_voice',
    version: nextVersion,
    snapshot: parsed.data as Record<string, unknown>,
  })

  return NextResponse.json({ brand_voice: updatedBrandVoice, version: nextVersion }, { status: 200 })
}
