// F-CP-054: Keyword blacklist / exclusion management
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const blacklistBody = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(500),
  reason: z.string().max(300).optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('scp_keywords')
    .select('id, keyword, status, updated_at')
    .eq('app_id', appId)
    .eq('status', 'excluded')
    .order('updated_at', { ascending: false })
    .limit(1000)

  if (error) return jsonError(500, 'query_failed', error.message)
  return NextResponse.json({ blacklisted: data ?? [], count: data?.length ?? 0 })
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

  const parsed = blacklistBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const normalised = parsed.data.keywords.map((k) => k.toLowerCase().trim())

  // Upsert keywords as excluded (creates them if missing)
  const rows = normalised.map((k) => ({
    app_id: appId,
    keyword: k,
    status: 'excluded' as const,
    source: 'blacklist',
    created_at: now,
    updated_at: now,
  }))

  const { data, error } = await admin
    .from('scp_keywords')
    .upsert(rows, { onConflict: 'app_id,keyword', ignoreDuplicates: false })
    .select('id, keyword, status')

  if (error) return jsonError(500, 'upsert_failed', error.message)

  return NextResponse.json({
    blacklisted: data?.length ?? 0,
    keywords: data ?? [],
    reason: parsed.data.reason ?? null,
  })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const keyword = request.nextUrl.searchParams.get('keyword')
  if (!keyword) return jsonError(400, 'missing_keyword', 'Provide ?keyword= to remove from blacklist')

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_keywords')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('app_id', appId)
    .eq('keyword', keyword.toLowerCase().trim())
    .eq('status', 'excluded')

  if (error) return jsonError(500, 'update_failed', error.message)
  return NextResponse.json({ removed_from_blacklist: keyword.toLowerCase().trim() })
}
