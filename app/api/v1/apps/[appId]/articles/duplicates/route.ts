// F-CP-070: Article duplicate detection
// Finds articles sharing the same focus_keyword or very similar titles.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function tokenise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

const SIMILARITY_THRESHOLD = 0.6

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()

  const { data: articles, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, status, focus_keyword, published_at')
    .eq('app_id', appId)
    .not('status', 'eq', 'archived')
    .order('published_at', { ascending: false })
    .limit(2000)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = articles ?? []

  // Group 1: exact focus_keyword duplicates
  const kwGroups = new Map<string, typeof rows>()
  for (const a of rows) {
    if (!a.focus_keyword) continue
    const kw = (a.focus_keyword as string).toLowerCase().trim()
    if (!kwGroups.has(kw)) kwGroups.set(kw, [])
    kwGroups.get(kw)!.push(a)
  }

  const keywordDuplicates = Array.from(kwGroups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([kw, group]) => ({
      type: 'exact_keyword' as const,
      focus_keyword: kw,
      count: group.length,
      articles: group.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        status: a.status,
        published_at: a.published_at,
      })),
    }))

  // Group 2: similar titles via Jaccard similarity
  const titlePairs: Array<{
    type: 'similar_title'
    similarity: number
    article_a: { id: string; slug: string; title: string }
    article_b: { id: string; slug: string; title: string }
  }> = []

  for (let i = 0; i < Math.min(rows.length, 500); i++) {
    const tokensA = tokenise((rows[i].title as string) ?? '')
    for (let j = i + 1; j < Math.min(rows.length, 500); j++) {
      const tokensB = tokenise((rows[j].title as string) ?? '')
      const sim = jaccardSimilarity(tokensA, tokensB)
      if (sim >= SIMILARITY_THRESHOLD) {
        titlePairs.push({
          type: 'similar_title',
          similarity: Math.round(sim * 100) / 100,
          article_a: { id: rows[i].id, slug: rows[i].slug as string, title: rows[i].title as string },
          article_b: { id: rows[j].id, slug: rows[j].slug as string, title: rows[j].title as string },
        })
      }
    }
  }

  titlePairs.sort((a, b) => b.similarity - a.similarity)

  return NextResponse.json({
    summary: {
      total_articles_scanned: rows.length,
      exact_keyword_duplicate_groups: keywordDuplicates.length,
      similar_title_pairs: titlePairs.length,
    },
    exact_keyword_duplicates: keywordDuplicates,
    similar_title_pairs: titlePairs.slice(0, 100),
    scanned_at: new Date().toISOString(),
  })
}
