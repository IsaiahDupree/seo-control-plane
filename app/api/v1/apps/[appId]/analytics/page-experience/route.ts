// Page experience metrics — Core Web Vitals and engagement signals per article
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const metricsBody = z.object({
  article_id: z.string().uuid(),
  lcp_ms: z.number().min(0).optional(),
  fid_ms: z.number().min(0).optional(),
  cls_score: z.number().min(0).optional(),
  ttfb_ms: z.number().min(0).optional(),
  inp_ms: z.number().min(0).optional(),
  mobile_score: z.number().int().min(0).max(100).optional(),
  desktop_score: z.number().int().min(0).max(100).optional(),
  captured_at: z.string().datetime().optional(),
})

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '30', 10), 200)
  const sortBy = searchParams.get('sort_by') ?? 'lcp' // lcp | cls | mobile_score

  const admin = createAdminClient()

  const { data: metrics, error } = await admin
    .from('scp_page_experience')
    .select('article_id, lcp_ms, fid_ms, cls_score, ttfb_ms, inp_ms, mobile_score, desktop_score, captured_at')
    .eq('app_id', appId)
    .order('captured_at', { ascending: false })
    .limit(limit)

  if (error) return jsonError(500, 'query_failed', error.message)

  const artIds = [...new Set((metrics ?? []).map((m) => m.article_id as string).filter(Boolean))]
  const { data: articles } = artIds.length
    ? await admin.from('scp_articles').select('id, slug, title').in('id', artIds)
    : { data: [] }

  const artMap = new Map(((articles ?? []) as { id: string; slug: string; title: string }[]).map((a) => [a.id, a]))

  const enriched = (metrics ?? []).map((m) => {
    const art = artMap.get(m.article_id as string)
    const lcpMs = m.lcp_ms as number | null
    const clsScore = m.cls_score as number | null
    const lcpGrade = lcpMs === null ? null : lcpMs <= 2500 ? 'good' : lcpMs <= 4000 ? 'needs_improvement' : 'poor'
    const clsGrade = clsScore === null ? null : clsScore <= 0.1 ? 'good' : clsScore <= 0.25 ? 'needs_improvement' : 'poor'
    return {
      article_id: m.article_id,
      slug: art?.slug ?? null,
      title: art?.title ?? null,
      lcp_ms: lcpMs,
      lcp_grade: lcpGrade,
      fid_ms: m.fid_ms ?? null,
      cls_score: clsScore,
      cls_grade: clsGrade,
      ttfb_ms: m.ttfb_ms ?? null,
      inp_ms: m.inp_ms ?? null,
      mobile_score: m.mobile_score ?? null,
      desktop_score: m.desktop_score ?? null,
      captured_at: m.captured_at,
    }
  })

  const sorted = sortBy === 'cls'
    ? enriched.sort((a, b) => (b.cls_score ?? 0) - (a.cls_score ?? 0))
    : sortBy === 'mobile_score'
    ? enriched.sort((a, b) => (a.mobile_score ?? 100) - (b.mobile_score ?? 100))
    : enriched.sort((a, b) => (b.lcp_ms ?? 0) - (a.lcp_ms ?? 0))

  return NextResponse.json({
    sort_by: sortBy,
    total: sorted.length,
    metrics: sorted,
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = metricsBody.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  const now = parsed.data.captured_at ?? new Date().toISOString()

  const { error } = await admin
    .from('scp_page_experience')
    .upsert({
      app_id: appId,
      article_id: parsed.data.article_id,
      lcp_ms: parsed.data.lcp_ms ?? null,
      fid_ms: parsed.data.fid_ms ?? null,
      cls_score: parsed.data.cls_score ?? null,
      ttfb_ms: parsed.data.ttfb_ms ?? null,
      inp_ms: parsed.data.inp_ms ?? null,
      mobile_score: parsed.data.mobile_score ?? null,
      desktop_score: parsed.data.desktop_score ?? null,
      captured_at: now,
    }, { onConflict: 'app_id,article_id' })

  if (error) return jsonError(500, 'insert_failed', error.message)

  return NextResponse.json({ article_id: parsed.data.article_id, stored: true, captured_at: now })
}
