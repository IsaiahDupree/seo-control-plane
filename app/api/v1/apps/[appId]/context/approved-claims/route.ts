// Approved and prohibited claims — product truth guardrails for content generation
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const claimsBody = z.object({
  approved_claims: z.array(z.string().max(500)).max(100).optional(),
  prohibited_claims: z.array(z.string().max(500)).max(100).optional(),
  sensitive_topics: z.array(z.string().max(200)).max(50).optional(),
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

  return NextResponse.json({
    approved_claims: (ctx.approved_claims ?? []) as string[],
    prohibited_claims: (ctx.prohibited_claims ?? []) as string[],
    sensitive_topics: (ctx.sensitive_topics ?? []) as string[],
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = claimsBody.safeParse(json)
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

  const updates: Record<string, unknown> = {}
  if (parsed.data.approved_claims !== undefined) updates.approved_claims = parsed.data.approved_claims
  if (parsed.data.prohibited_claims !== undefined) updates.prohibited_claims = parsed.data.prohibited_claims
  if (parsed.data.sensitive_topics !== undefined) updates.sensitive_topics = parsed.data.sensitive_topics

  const { error } = await admin
    .from('scp_apps')
    .update({ context: { ...prevCtx, ...updates }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ ...updates })
}
