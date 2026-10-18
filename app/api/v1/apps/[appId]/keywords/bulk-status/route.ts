// F-CP-042: Keyword status bulk update
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const bulkStatusBody = z.object({
  keywords: z.array(z.string().min(1).max(200)).min(1).max(500).optional(),
  keyword_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  status: z.enum(['active', 'paused', 'archived', 'excluded']),
  reason: z.string().max(300).optional(),
})

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

  const parsed = bulkStatusBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  if (!parsed.data.keywords?.length && !parsed.data.keyword_ids?.length) {
    return jsonError(400, 'missing_target', 'Provide either keywords or keyword_ids')
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  let query = admin
    .from('scp_keywords')
    .update({ status: parsed.data.status, updated_at: now })
    .eq('app_id', appId)

  if (parsed.data.keyword_ids?.length) {
    query = query.in('id', parsed.data.keyword_ids)
  } else if (parsed.data.keywords?.length) {
    query = query.in('keyword', parsed.data.keywords.map((k) => k.toLowerCase().trim()))
  }

  const { data, error } = await query.select('id, keyword, status')

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({
    updated: data?.length ?? 0,
    status: parsed.data.status,
    reason: parsed.data.reason ?? null,
    keywords: data ?? [],
  })
}
