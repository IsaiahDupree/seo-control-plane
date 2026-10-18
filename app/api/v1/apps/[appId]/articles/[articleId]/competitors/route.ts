// Competitor articles for a given article — find competing pages on tracked domains
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const competitorBody = z.object({
  competitor_pages: z.array(z.object({
    domain: z.string().max(300),
    url: z.string().url(),
    title: z.string().max(500).optional(),
    position: z.number().int().min(1).max(1000).optional(),
    estimated_traffic: z.number().int().min(0).optional(),
    word_count: z.number().int().min(0).optional(),
  })).min(1).max(20),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, title, focus_keyword')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const { data: competitors, error } = await admin
    .from('scp_competitor_pages')
    .select('id, domain, url, title, position, estimated_traffic, word_count, captured_at')
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .order('position', { ascending: true, nullsFirst: false })

  if (error) return jsonError(500, 'query_failed', error.message)

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    focus_keyword: article.focus_keyword ?? null,
    competitors: competitors ?? [],
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = competitorBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const rows = parsed.data.competitor_pages.map((p) => ({
    app_id: appId,
    article_id: articleId,
    domain: p.domain,
    url: p.url,
    title: p.title ?? null,
    position: p.position ?? null,
    estimated_traffic: p.estimated_traffic ?? null,
    word_count: p.word_count ?? null,
    captured_at: now,
  }))

  const { data, error } = await admin
    .from('scp_competitor_pages')
    .upsert(rows, { onConflict: 'app_id,article_id,url' })
    .select('id, domain, url, position')

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ article_id: articleId, stored: (data ?? []).length }, { status: 201 })
}
