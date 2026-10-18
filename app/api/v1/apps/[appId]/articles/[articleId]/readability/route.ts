// F-CP-056: Article readability score
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string; articleId: string }> }

function syllableCount(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '')
  if (word.length <= 3) return 1
  const vowelGroups = word.match(/[aeiouy]+/g) ?? []
  let count = vowelGroups.length
  if (word.endsWith('e')) count--
  return Math.max(1, count)
}

function fleschKincaidGrade(text: string): { grade: number; ease: number; sentences: number; words: number; syllables: number } {
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1
  const wordList = text.trim().split(/\s+/).filter((w) => w.length > 0)
  const words = wordList.length || 1
  const syllables = wordList.reduce((sum, w) => sum + syllableCount(w), 0)

  const ease = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words)
  const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59

  return {
    grade: Math.round(grade * 10) / 10,
    ease: Math.round(ease * 10) / 10,
    sentences,
    words,
    syllables,
  }
}

function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function avgSentenceLength(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) return 0
  const totalWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0)
  return Math.round(totalWords / sentences.length)
}

function passiveVoiceRatio(text: string): number {
  const passivePattern = /\b(is|are|was|were|be|been|being)\s+\w+ed\b/gi
  const matches = (text.match(passivePattern) ?? []).length
  const sentences = (text.match(/[.!?]+/g) ?? []).length || 1
  return Math.round((matches / sentences) * 100) / 100
}

function transitionWordRatio(text: string): number {
  const transitions = [
    'however', 'therefore', 'furthermore', 'moreover', 'additionally',
    'consequently', 'nevertheless', 'although', 'because', 'since',
    'while', 'whereas', 'thus', 'hence', 'accordingly', 'meanwhile',
    'subsequently', 'finally', 'first', 'second', 'third', 'also',
    'besides', 'similarly', 'in contrast', 'on the other hand',
    'as a result', 'in addition', 'for example', 'for instance',
  ]
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) return 0
  const withTransition = sentences.filter((s) => {
    const lower = s.toLowerCase()
    return transitions.some((t) => lower.startsWith(t) || lower.includes(` ${t} `))
  }).length
  return Math.round((withTransition / sentences.length) * 100)
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId, articleId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: article, error } = await admin
    .from('scp_articles')
    .select('id, slug, title, body_mdx')
    .eq('id', articleId)
    .eq('app_id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!article) return jsonError(404, 'not_found', 'Article not found')

  const plainText = stripMarkdown((article.body_mdx as string) ?? '')
  const fk = fleschKincaidGrade(plainText)
  const avgSentLen = avgSentenceLength(plainText)
  const passiveRatio = passiveVoiceRatio(plainText)
  const transitionPct = transitionWordRatio(plainText)

  // Flesch ease: 90-100 very easy, 60-70 standard, 30-50 difficult, <30 very confusing
  const readabilityLabel =
    fk.ease >= 80 ? 'very easy' :
    fk.ease >= 60 ? 'standard' :
    fk.ease >= 40 ? 'difficult' : 'very difficult'

  const gradeLabel =
    fk.grade <= 6 ? 'elementary' :
    fk.grade <= 8 ? 'middle school' :
    fk.grade <= 12 ? 'high school' :
    fk.grade <= 16 ? 'college' : 'post-graduate'

  // Composite readability score (0-100, higher is more readable / accessible)
  const compositeScore = Math.round(
    Math.min(100, Math.max(0,
      fk.ease * 0.5 +
      (avgSentLen <= 20 ? 20 : Math.max(0, 20 - (avgSentLen - 20))) +
      (passiveRatio < 0.1 ? 15 : Math.max(0, 15 - passiveRatio * 50)) +
      (transitionPct >= 30 ? 15 : transitionPct / 2)
    ))
  )

  return NextResponse.json({
    article_id: articleId,
    slug: article.slug,
    readability: {
      composite_score: compositeScore,
      flesch_ease: fk.ease,
      flesch_kincaid_grade: fk.grade,
      reading_level: gradeLabel,
      readability_label: readabilityLabel,
      avg_sentence_length: avgSentLen,
      passive_voice_ratio: passiveRatio,
      transition_word_pct: transitionPct,
      stats: {
        words: fk.words,
        sentences: fk.sentences,
        syllables: fk.syllables,
      },
    },
    recommendations: [
      ...(avgSentLen > 25 ? ['Shorten sentences (avg > 25 words)'] : []),
      ...(passiveRatio > 0.2 ? ['Reduce passive voice usage'] : []),
      ...(transitionPct < 20 ? ['Add more transition words between paragraphs'] : []),
      ...(fk.ease < 50 ? ['Simplify vocabulary for broader audience'] : []),
    ],
    scored_at: new Date().toISOString(),
  })
}
