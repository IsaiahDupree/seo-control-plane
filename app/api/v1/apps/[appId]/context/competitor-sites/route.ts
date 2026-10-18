// Competitor sites configuration — manage list of tracked competitor domains
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const competitorBody = z.object({
  competitors: z.array(z.object({
    domain: z.string().max(300),
    label: z.string().max(200).optional(),
    track_serp: z.boolean().default(true),
    notes: z.string().max(500).optional(),
  })).min(1).max(20),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_competitor_domains')
    .select('id, domain, label, track_serp, notes, created_at')
    .eq('app_id', appId)
    .order('created_at', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({ competitors: data ?? [] })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = competitorBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const rows = parsed.data.competitors.map((c) => ({
    app_id: appId,
    domain: c.domain,
    label: c.label ?? null,
    track_serp: c.track_serp,
    notes: c.notes ?? null,
    created_at: now,
    updated_at: now,
  }))

  const { data, error } = await admin
    .from('scp_competitor_domains')
    .upsert(rows, { onConflict: 'app_id,domain' })
    .select('id, domain, label, track_serp')

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ competitors: data ?? [], count: (data ?? []).length }, { status: 201 })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const domain = searchParams.get('domain')
  if (!domain) return jsonError(400, 'missing_param', 'domain query param required')

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_competitor_domains')
    .delete()
    .eq('app_id', appId)
    .eq('domain', domain)

  if (error) return jsonError(500, 'delete_failed', error.message)

  return NextResponse.json({ deleted: domain })
}
