// Suggest new keywords extracted from an article body
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const STOP_WORDS = new Set(['the','and','for','that','this','are','was','with','from','have','been','will','your','they','their','into','more','also','can','has','not','but','you','its','our','which','about','what','when','there','than','then','some','any','how','all','one','would','could','should','like','just','make','use','get','let','new','now','see','may','do','is','it','in','of','to','a','an','be','by','on','at','or','if','so','as','up','we','my','he','she','his','her','its','this','that','these','those','do','did','does','had','has','have','been','being','am','are','was','were','will','would','can','could','may','might','shall','should','must','ought'])

function extractPhrases(text: string, minLen = 2, maxLen = 4): Map<string, number> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  const phrases = new Map<string, number>()
  for (let i = 0; i < words.length; i++) {
    for (let len = minLen; len <= maxLen && i + len <= words.length; len++) {
      const phrase = words.slice(i, i + len).join(' ')
      if (phrase.length > 5) phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1)
    }
    // Single important words
    phrases.set(words[i], (phrases.get(words[i]) ?? 0) + 1)
  }
  return phrases
}

const bodySchema = z.object({
  article_id: z.string().uuid().optional(),
  body_text: z.string().max(50000).optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try { json = await request.json() } catch { return jsonError(400, 'invalid_json', 'Body must be JSON') }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) return jsonError(400, 'validation_error', parsed.error.message)

  const admin = createAdminClient()
  let bodyText = parsed.data.body_text ?? ''

  if (parsed.data.article_id && !bodyText) {
    const { data: article, error } = await admin
      .from('scp_articles')
      .select('body_mdx, title, description')
      .eq('id', parsed.data.article_id)
      .eq('app_id', appId)
      .maybeSingle()

    if (error) return jsonError(500, 'query_failed', error.message)
    if (!article) return jsonError(404, 'not_found', 'Article not found')
    bodyText = [(article.title as string | null) ?? '', (article.description as string | null) ?? '', (article.body_mdx as string | null) ?? ''].join(' ')
  }

  if (!bodyText.trim()) return jsonError(400, 'missing_body', 'Provide body_text or article_id with content')

  // Extract phrases and rank by frequency
  const phrases = extractPhrases(bodyText)

  // Load existing keywords to de-duplicate
  const { data: existingKw } = await admin
    .from('scp_keywords')
    .select('keyword')
    .eq('app_id', appId)
    .limit(5000)

  const existingSet = new Set((existingKw ?? []).map((k) => k.keyword.toLowerCase()))

  const suggestions = Array.from(phrases.entries())
    .filter(([phrase]) => !existingSet.has(phrase))
    .sort(([, a], [, b]) => b - a)
    .slice(0, parsed.data.limit)
    .map(([phrase, freq]) => ({
      keyword: phrase,
      frequency_in_body: freq,
      word_count: phrase.split(' ').length,
      already_tracked: existingSet.has(phrase),
    }))

  return NextResponse.json({
    article_id: parsed.data.article_id ?? null,
    suggestions_count: suggestions.length,
    suggestions,
  })
}
