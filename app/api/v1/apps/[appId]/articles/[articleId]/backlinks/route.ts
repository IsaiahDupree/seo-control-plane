// Per-article backlinks — store and retrieve external backlink data
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

const backlinkBody = z.object({
  backlinks: z.array(z.object({
    source_url: z.string().url(),
    source_domain: z.string().max(300),
    anchor_text: z.string().max(500).optional(),
    domain_rating: z.number().min(0).max(100).optional(),
    is_dofollow: z.boolean().default(true),
    first_seen_at: z.string().datetime().optional(),
  })).min(1).max(200),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)
  const dofollowOnly = searchParams.get('dofollow_only') === 'true'

  const admin = createAdminClient()

  const { data: article, error: artErr } = await admin
    .from('scp_articles')
    .select('id, slug, focus_keyword')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (artErr) return jsonError(500, 'query_failed', artErr.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  let query = admin
    .from('scp_backlinks')
    .select('id, source_url, source_domain, anchor_text, domain_rating, is_dofollow, first_seen_at, created_at')
    .eq('app_id', appId)
    .eq('article_id', articleId)
    .order('domain_rating', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (dofollowOnly) query = query.eq('is_dofollow', true)

  const { data: backlinks, error } = await query
  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = backlinks ?? []
  const avgDr = rows.filter((b) => b.domain_rating !== null).length > 0
    ? Math.round(rows.reduce((s, b) => s + ((b.domain_rating as number) ?? 0), 0) / rows.length)
    : null

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    total_backlinks: rows.length,
    dofollow_count: rows.filter((b) => b.is_dofollow).length,
    avg_domain_rating: avgDr,
    backlinks: rows,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = backlinkBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const rows = parsed.data.backlinks.map((b) => ({
    app_id: appId,
    article_id: articleId,
    source_url: b.source_url,
    source_domain: b.source_domain,
    anchor_text: b.anchor_text ?? null,
    domain_rating: b.domain_rating ?? null,
    is_dofollow: b.is_dofollow,
    first_seen_at: b.first_seen_at ?? now,
    created_at: now,
  }))

  const { error } = await admin
    .from('scp_backlinks')
    .upsert(rows, { onConflict: 'app_id,article_id,source_url' })

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ article_id: articleId, stored: rows.length }, { status: 201 })
}
