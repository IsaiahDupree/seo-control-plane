// F-CP-055: Article on-page SEO score
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function keywordDensity(text: string, keyword: string): number {
  if (!keyword || !text) return 0
  const kw = keyword.toLowerCase()
  const words = text.toLowerCase().split(/\s+/)
  const matches = words.filter((w) => w.includes(kw)).length
  return words.length > 0 ? Math.round((matches / words.length) * 1000) / 10 : 0
}

function scoreArticle(article: Record<string, unknown>) {
  const checks: Array<{ name: string; passed: boolean; score: number; max: number; message: string }> = []

  const title = (article.title as string) ?? ''
  const description = (article.description as string) ?? ''
  const bodyMdx = (article.body_mdx as string) ?? ''
  const focusKeyword = ((article.focus_keyword as string) ?? '').toLowerCase()
  const metaJson = (article.meta_json as Record<string, unknown>) ?? {}
  const wordCount = countWords(bodyMdx)

  // 1. Focus keyword set
  checks.push({
    name: 'focus_keyword',
    passed: !!focusKeyword,
    score: focusKeyword ? 10 : 0,
    max: 10,
    message: focusKeyword ? 'Focus keyword is set' : 'Missing focus keyword',
  })

  // 2. Title contains keyword
  const titleHasKw = focusKeyword ? title.toLowerCase().includes(focusKeyword) : false
  checks.push({
    name: 'keyword_in_title',
    passed: titleHasKw,
    score: titleHasKw ? 15 : 0,
    max: 15,
    message: titleHasKw ? 'Focus keyword in title' : 'Focus keyword not found in title',
  })

  // 3. Title length (50-60 chars ideal)
  const titleLen = title.length
  const titleOk = titleLen >= 30 && titleLen <= 70
  checks.push({
    name: 'title_length',
    passed: titleOk,
    score: titleOk ? 10 : titleLen > 0 ? 5 : 0,
    max: 10,
    message: `Title is ${titleLen} chars (ideal: 30-70)`,
  })

  // 4. Meta description
  const descLen = description.length
  const descOk = descLen >= 120 && descLen <= 160
  const descExists = descLen > 0
  checks.push({
    name: 'meta_description',
    passed: descOk,
    score: descOk ? 10 : descExists ? 5 : 0,
    max: 10,
    message: descOk ? `Meta description length OK (${descLen} chars)` : `Meta description is ${descLen} chars (ideal: 120-160)`,
  })

  // 5. Word count
  const wcOk = wordCount >= 800
  checks.push({
    name: 'word_count',
    passed: wcOk,
    score: wordCount >= 1500 ? 10 : wordCount >= 800 ? 8 : wordCount >= 400 ? 5 : 0,
    max: 10,
    message: `Word count: ${wordCount} (minimum: 800)`,
  })

  // 6. Keyword in first paragraph (first 200 words)
  const firstParagraph = bodyMdx.split(/\n\n/)[0] ?? ''
  const kwInIntro = focusKeyword ? firstParagraph.toLowerCase().includes(focusKeyword) : false
  checks.push({
    name: 'keyword_in_intro',
    passed: kwInIntro,
    score: kwInIntro ? 10 : 0,
    max: 10,
    message: kwInIntro ? 'Keyword appears in introduction' : 'Keyword not found in first paragraph',
  })

  // 7. Keyword density (ideal 0.5-2.5%)
  const density = keywordDensity(bodyMdx, focusKeyword)
  const densityOk = density >= 0.5 && density <= 2.5
  checks.push({
    name: 'keyword_density',
    passed: densityOk,
    score: densityOk ? 10 : 5,
    max: 10,
    message: `Keyword density: ${density}% (ideal: 0.5-2.5%)`,
  })

  // 8. Has H2 headings
  const h2Count = (bodyMdx.match(/^## /gm) ?? []).length
  const hasH2 = h2Count >= 2
  checks.push({
    name: 'heading_structure',
    passed: hasH2,
    score: h2Count >= 3 ? 10 : h2Count >= 1 ? 6 : 0,
    max: 10,
    message: `Found ${h2Count} H2 headings (recommended: 2+)`,
  })

  // 9. Internal links (from meta_json or body link count)
  const internalLinks = (metaJson.internal_links as unknown[]) ?? []
  const bodyLinks = (bodyMdx.match(/\[.*?\]\(\/[^)]+\)/g) ?? []).length
  const linkCount = internalLinks.length + bodyLinks
  const hasLinks = linkCount >= 2
  checks.push({
    name: 'internal_links',
    passed: hasLinks,
    score: linkCount >= 3 ? 10 : linkCount >= 1 ? 5 : 0,
    max: 10,
    message: `Found ${linkCount} internal links (recommended: 2+)`,
  })

  // 10. Schema / OG metadata
  const hasOg = !!(metaJson.og_title || metaJson.og_image || article.og_image_url)
  checks.push({
    name: 'og_metadata',
    passed: hasOg,
    score: hasOg ? 5 : 0,
    max: 5,
    message: hasOg ? 'OG metadata present' : 'Missing OG metadata (og_title / og_image)',
  })

  const totalScore = checks.reduce((s, c) => s + c.score, 0)
  const maxScore = checks.reduce((s, c) => s + c.max, 0)

  return { checks, total_score: totalScore, max_score: maxScore, pct: Math.round((totalScore / maxScore) * 100) }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, description, body_mdx, focus_keyword, meta_json, status, updated_at')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const result = scoreArticle(article as Record<string, unknown>)

  const grade =
    result.pct >= 90 ? 'A' :
    result.pct >= 80 ? 'B' :
    result.pct >= 70 ? 'C' :
    result.pct >= 60 ? 'D' : 'F'

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    seo_score: result.total_score,
    max_score: result.max_score,
    pct: result.pct,
    grade,
    checks: result.checks,
    scored_at: new Date().toISOString(),
  })
}
