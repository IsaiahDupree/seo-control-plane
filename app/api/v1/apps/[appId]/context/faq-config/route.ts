// FAQ configuration — app-level FAQ templates and approved Q&A pairs
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const faqBody = z.object({
  faqs: z.array(z.object({
    question: z.string().max(500),
    answer: z.string().max(2000),
    category: z.string().max(100).optional(),
    include_in_schema: z.boolean().default(true),
  })).max(50),
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
  const faqs = (ctx.faqs ?? []) as unknown[]

  return NextResponse.json({ faqs })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = faqBody.safeParse(json)
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
    .update({ context: { ...prevCtx, faqs: parsed.data.faqs }, updated_at: new Date().toISOString() })
    .eq('id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ faqs: parsed.data.faqs, count: parsed.data.faqs.length })
}
