// F-CP-003: App persona library sync
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const personaSchema = z.object({
  name: z.string().min(1).max(100),
  job_title: z.string().max(150).optional(),
  pain_points: z.array(z.string().max(300)).max(20).default([]),
  goals: z.array(z.string().max(300)).max(20).default([]),
  objections: z.array(z.string().max(300)).max(20).default([]),
  vocabulary: z.array(z.string().max(100)).max(50).default([]),
})

const personasBody = z.object({
  personas: z.array(personaSchema).min(1).max(20),
  replace: z.boolean().default(false),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_app_personas')
    .select('*')
    .eq('app_id', appId)
    .order('sort_order', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ personas: data ?? [] })
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

  const parsed = personasBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (parsed.data.replace) {
    await admin.from('scp_app_personas').delete().eq('app_id', appId)
  }

  const rows = parsed.data.personas.map((p, idx) => ({
    app_id: appId,
    ...p,
    sort_order: idx,
    updated_at: now,
  }))

  const { data, error } = await admin
    .from('scp_app_personas')
    .insert(rows)
    .select('*')

  if (error) return jsonError(500, 'insert_failed', error.message)

  // Version history (F-CP-008)
  const { data: countRow } = await admin
    .from('scp_app_sync_logs')
    .select('version')
    .eq('app_id', appId)
    .eq('sync_type', 'personas')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (countRow?.version ?? 0) + 1
  await admin.from('scp_app_sync_logs').insert({
    app_id: appId,
    sync_type: 'personas',
    version: nextVersion,
    snapshot: { personas: parsed.data.personas, replace: parsed.data.replace },
  })

  return NextResponse.json(
    { personas: data, count: data?.length ?? 0, version: nextVersion },
    { status: 200 }
  )
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { error } = await admin.from('scp_app_personas').delete().eq('app_id', appId)
  if (error) return jsonError(500, 'delete_failed', error.message)

  return NextResponse.json({ deleted: true })
}
