// Keyword density analysis for an article body
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function getWordFrequency(text: string): Map<string, number> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, '').split(/\s+/).filter((w) => w.length > 2)
  const freq = new Map<string, number>()
  for (const word of words) freq.set(word, (freq.get(word) ?? 0) + 1)
  return freq
}

const STOP_WORDS = new Set(['the','and','for','that','this','are','was','with','from','have','been','will','your','they','their','into','more','also','can','has','not','but','you','its','our','which','about','what','when','there','than','then','some','any','how','all','one','would','could','should'])

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, focus_keyword, secondary_keywords, body_mdx, word_count')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const body = (article.body_mdx as string | null) ?? ''
  // Strip markdown syntax for word counting
  const cleanText = body.replace(/#{1,6}\s/g, '').replace(/[*_`~\[\]()>]/g, '').replace(/\n/g, ' ')

  const totalWords = cleanText.trim().split(/\s+/).filter(Boolean).length
  const freq = getWordFrequency(cleanText)

  // Focus keyword density
  const focusKw = (article.focus_keyword as string | null)?.toLowerCase().trim()
  const focusDensity = focusKw && totalWords > 0
    ? { keyword: focusKw, count: freq.get(focusKw) ?? 0, density_pct: Math.round(((freq.get(focusKw) ?? 0) / totalWords) * 10000) / 100 }
    : null

  // Secondary keyword densities
  const secondaryDensities = ((article.secondary_keywords as string[]) ?? []).map((kw) => {
    const k = kw.toLowerCase().trim()
    const count = freq.get(k) ?? 0
    return { keyword: k, count, density_pct: totalWords > 0 ? Math.round((count / totalWords) * 10000) / 100 : 0 }
  })

  // Top non-stop words
  const topWords = Array.from(freq.entries())
    .filter(([w]) => !STOP_WORDS.has(w))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 30)
    .map(([word, count]) => ({ word, count, density_pct: totalWords > 0 ? Math.round((count / totalWords) * 10000) / 100 : 0 }))

  return NextResponse.json({
    article_id: articleId,
    total_words: totalWords,
    focus_keyword: focusDensity,
    secondary_keywords: secondaryDensities,
    top_words: topWords,
    recommendation: focusDensity
      ? focusDensity.density_pct < 0.5
        ? 'Focus keyword appears rarely — consider using it more naturally'
        : focusDensity.density_pct > 3
        ? 'Focus keyword density may be too high — risk of over-optimisation'
        : 'Keyword density looks healthy'
      : 'Set a focus keyword to get density recommendations',
  })
}
