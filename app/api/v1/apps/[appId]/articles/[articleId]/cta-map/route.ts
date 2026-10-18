// CTA map for an article — get and update CTA blocks mapped to this article
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const ctaBlockSchema = z.object({
  cta_id: z.string().uuid().optional(),
  label: z.string().max(200),
  url: z.string().url(),
  placement: z.enum(['inline', 'end', 'sidebar', 'popup']).default('end'),
  funnel_stage: z.enum(['awareness', 'consideration', 'conversion']).optional(),
  trigger_phrase: z.string().max(300).optional(),
})

const bodySchema = z.object({
  cta_blocks: z.array(ctaBlockSchema).max(10),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, cta_blocks')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    cta_blocks: article.cta_blocks ?? [],
  })
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const { error } = await admin
    .from('scp_articles')
    .update({ cta_blocks: parsed.data.cta_blocks, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .eq('app_id', appId)

  if (error) return jsonError(500, 'update_failed', error.message)

  return NextResponse.json({ article_id: articleId, cta_blocks: parsed.data.cta_blocks })
}
