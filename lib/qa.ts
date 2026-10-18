import { callLLM } from '@/lib/llm'
import { createAdminClient } from '@/lib/supabase'

export interface QAInput {
  articleId: string
  appId: string
  title: string
  contentHtml: string
  contentMarkdown: string
  metaTitle: string
  metaDescription: string
  focusKeyword: string
  wordCount: number
  contentType: string
}

export interface QAResult {
  overallScore: number
  qualityScore: number
  seoScore: number
  readabilityScore: number
  checksPassed: string[]
  checksFailed: string[]
  blockingIssues: string[]
  warnings: string[]
  outcome: 'approved' | 'rejected' | 'needs_revision'
}

export async function runQA(input: QAInput): Promise<QAResult> {
  const checks = await Promise.all([
    checkWordCount(input),
    checkMetaTags(input),
    checkKeywordPresence(input),
    checkHeadingStructure(input),
    checkReadability(input),
  ])

  const checksPassed: string[] = []
  const checksFailed: string[] = []
  const blockingIssues: string[] = []
  const warnings: string[] = []

  for (const check of checks) {
    if (check.passed) {
      checksPassed.push(check.name)
    } else {
      checksFailed.push(check.name)
      if (check.blocking) {
        blockingIssues.push(check.message)
      } else {
        warnings.push(check.message)
      }
    }
  }

  // LLM quality check
  const llmCheck = await runLLMQualityCheck(input)
  const qualityScore = llmCheck.score
  const seoScore = calculateSEOScore(input)
  const readabilityScore = calculateReadabilityScore(input)
  const overallScore = Math.round((qualityScore * 0.4) + (seoScore * 0.35) + (readabilityScore * 0.25))

  if (llmCheck.issues.length > 0) {
    warnings.push(...llmCheck.issues)
  }

  let outcome: 'approved' | 'rejected' | 'needs_revision'
  if (blockingIssues.length > 0 || overallScore < 60) {
    outcome = 'rejected'
  } else if (overallScore < 75) {
    outcome = 'needs_revision'
  } else {
    outcome = 'approved'
  }

  return {
    overallScore,
    qualityScore,
    seoScore,
    readabilityScore,
    checksPassed,
    checksFailed,
    blockingIssues,
    warnings,
    outcome,
  }
}

interface CheckResult {
  name: string
  passed: boolean
  blocking: boolean
  message: string
}

function checkWordCount(input: QAInput): CheckResult {
  const name = 'word_count'
  if (input.wordCount < 300) {
    return { name, passed: false, blocking: true, message: `Word count too low: ${input.wordCount} (minimum 300)` }
  }
  if (input.wordCount < 600) {
    return { name, passed: false, blocking: false, message: `Word count below recommended: ${input.wordCount} (recommended 600+)` }
  }
  return { name, passed: true, blocking: false, message: '' }
}

function checkMetaTags(input: QAInput): CheckResult {
  const name = 'meta_tags'
  if (!input.metaTitle || input.metaTitle.length < 10) {
    return { name, passed: false, blocking: true, message: 'Missing or too short meta title' }
  }
  if (!input.metaDescription || input.metaDescription.length < 50) {
    return { name, passed: false, blocking: false, message: 'Missing or too short meta description' }
  }
  if (input.metaTitle.length > 65) {
    return { name, passed: false, blocking: false, message: `Meta title too long: ${input.metaTitle.length} chars (max 65)` }
  }
  if (input.metaDescription.length > 160) {
    return { name, passed: false, blocking: false, message: `Meta description too long: ${input.metaDescription.length} chars (max 160)` }
  }
  return { name, passed: true, blocking: false, message: '' }
}

function checkKeywordPresence(input: QAInput): CheckResult {
  const name = 'keyword_presence'
  const keyword = input.focusKeyword.toLowerCase()
  const text = (input.title + ' ' + input.contentMarkdown).toLowerCase()
  const count = (text.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
  if (count === 0) {
    return { name, passed: false, blocking: true, message: `Focus keyword "${input.focusKeyword}" not found in article` }
  }
  if (count < 2) {
    return { name, passed: false, blocking: false, message: `Focus keyword appears only once (recommend 2-4 times)` }
  }
  return { name, passed: true, blocking: false, message: '' }
}

function checkHeadingStructure(input: QAInput): CheckResult {
  const name = 'heading_structure'
  const h2Count = (input.contentHtml.match(/<h2/gi) ?? []).length
  if (h2Count === 0) {
    return { name, passed: false, blocking: true, message: 'No H2 headings found — article must have section structure' }
  }
  if (h2Count < 2) {
    return { name, passed: false, blocking: false, message: 'Only one H2 heading found — recommend at least 2 sections' }
  }
  return { name, passed: true, blocking: false, message: '' }
}

function checkReadability(input: QAInput): CheckResult {
  const name = 'readability'
  const paragraphs = input.contentMarkdown.split(/\n\n+/).filter(Boolean)
  const longParas = paragraphs.filter((p) => p.split(' ').length > 120)
  if (longParas.length > paragraphs.length * 0.3) {
    return { name, passed: false, blocking: false, message: `${longParas.length} paragraphs exceed 120 words — split for readability` }
  }
  return { name, passed: true, blocking: false, message: '' }
}

async function runLLMQualityCheck(input: QAInput): Promise<{ score: number; issues: string[] }> {
  try {
    const res = await callLLM(
      [
        {
          role: 'system',
          content: 'You are an expert content quality evaluator. Be strict and precise.',
        },
        {
          role: 'user',
          content: `Rate this article on a scale of 0-100 and list any quality issues.

Title: ${input.title}
Focus Keyword: ${input.focusKeyword}
Content Type: ${input.contentType}
Word Count: ${input.wordCount}

First 800 chars of content:
${input.contentMarkdown.slice(0, 800)}

Return JSON only:
{
  "score": 85,
  "issues": ["issue 1 if any", "issue 2 if any"]
}`,
        },
      ],
      'gpt-4o-mini',
      300
    )

    const jsonMatch = res.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { score: number; issues: string[] }
      return { score: Math.min(100, Math.max(0, parsed.score ?? 70)), issues: parsed.issues ?? [] }
    }
  } catch {
    // Fall back to heuristic score
  }
  return { score: 70, issues: [] }
}

function calculateSEOScore(input: QAInput): number {
  let score = 100
  if (!input.metaTitle) score -= 20
  if (!input.metaDescription) score -= 15
  if (!input.focusKeyword) score -= 25
  const keywordInTitle = input.title.toLowerCase().includes(input.focusKeyword.toLowerCase())
  if (!keywordInTitle) score -= 10
  const h2Count = (input.contentHtml.match(/<h2/gi) ?? []).length
  if (h2Count < 2) score -= 10
  return Math.max(0, score)
}

function calculateReadabilityScore(input: QAInput): number {
  const words = input.contentMarkdown.split(/\s+/).filter(Boolean)
  const sentences = input.contentMarkdown.split(/[.!?]+/).filter(Boolean)
  if (sentences.length === 0) return 50
  const avgWordsPerSentence = words.length / sentences.length
  // Prefer 15-20 words per sentence
  if (avgWordsPerSentence < 10) return 85
  if (avgWordsPerSentence <= 20) return 90
  if (avgWordsPerSentence <= 25) return 75
  return 60
}

export async function saveQAReport(appId: string, articleId: string, result: QAResult): Promise<void> {
  const db = createAdminClient()

  await db.from('scp_qa_reports').insert({
    app_id: appId,
    article_id: articleId,
    overall_score: result.overallScore,
    quality_score: result.qualityScore,
    seo_score: result.seoScore,
    readability_score: result.readabilityScore,
    checks_passed: result.checksPassed,
    checks_failed: result.checksFailed,
    blocking_issues: result.blockingIssues,
    warnings: result.warnings,
    outcome: result.outcome,
  })

  await db
    .from('scp_articles')
    .update({
      qa_score: result.overallScore,
      status: result.outcome === 'approved' ? 'approved' : result.outcome === 'rejected' ? 'draft' : 'qa_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', articleId)
}
