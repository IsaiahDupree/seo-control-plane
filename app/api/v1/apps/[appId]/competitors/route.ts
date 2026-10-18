// F-CP-018: Competitor domain registration
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const competitorSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Must be a bare domain like example.com'),
  display_name: z.string().max(100).optional(),
  why_competitor: z.string().max(500).optional(),
})

const competitorsBody = z.object({
  competitors: z.array(competitorSchema).min(1).max(10),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_competitors')
    .select('*')
    .eq('app_id', appId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ competitors: data ?? [] })
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

  const parsed = competitorsBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  // Enforce max 10 active competitors
  const { count } = await admin
    .from('scp_competitors')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('is_active', true)

  const remainingSlots = 10 - (count ?? 0)
  if (remainingSlots <= 0) {
    return jsonError(400, 'limit_reached', 'Maximum 10 competitors per app')
  }
  if (parsed.data.competitors.length > remainingSlots) {
    return jsonError(
      400,
      'limit_exceeded',
      `Only ${remainingSlots} competitor slot(s) remaining`
    )
  }

  const now = new Date().toISOString()
  const rows = parsed.data.competitors.map((c) => ({
    app_id: appId,
    domain: c.domain.toLowerCase(),
    display_name: c.display_name ?? c.domain,
    why_competitor: c.why_competitor ?? null,
    is_active: true,
    updated_at: now,
  }))

  const { data, error } = await admin
    .from('scp_competitors')
    .upsert(rows, { onConflict: 'app_id,domain' })
    .select('*')

  if (error) return jsonError(500, 'upsert_failed', error.message)
  return NextResponse.json({ competitors: data, count: data?.length ?? 0 }, { status: 200 })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const domain = request.nextUrl.searchParams.get('domain')
  if (!domain) return jsonError(400, 'missing_domain', 'Provide ?domain= to delete')

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_competitors')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('app_id', appId)
    .eq('domain', domain.toLowerCase())

  if (error) return jsonError(500, 'update_failed', error.message)
  return NextResponse.json({ deleted: true, domain })
}
