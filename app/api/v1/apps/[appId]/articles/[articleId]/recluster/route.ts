// F-CP-072: Article cluster re-assignment
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const reclusterBody = z.object({
  cluster_name: z.string().min(1).max(150).nullable(),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = reclusterBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  const { data: article, error: fetchErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, cluster_name')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (fetchErr) return jsonError(500, 'query_failed', fetchErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const now = new Date().toISOString()
  const { error: updateErr } = await admin
    .from('scp_articles')
    .update({ cluster_name: parsed.data.cluster_name, updated_at: now })
    .eq('id', articleId)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    previous_cluster: (article as Record<string, unknown>).cluster_name as string | null ?? null,
    new_cluster: parsed.data.cluster_name,
    updated_at: now,
  })
}
