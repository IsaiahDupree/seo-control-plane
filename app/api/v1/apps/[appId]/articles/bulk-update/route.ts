// F-CP-058: Article bulk status update
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const bulkUpdateBody = z.object({
  article_ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['published', 'indexed', 'ranked', 'archived', 'draft']),
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

  const parsed = bulkUpdateBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('scp_articles')
    .update({ status: parsed.data.status, updated_at: now })
    .eq('app_id', appId)
    .in('id', parsed.data.article_ids)
    .select('id, slug, status')

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({
    updated: data?.length ?? 0,
    requested: parsed.data.article_ids.length,
    status: parsed.data.status,
    articles: data ?? [],
  })
}
