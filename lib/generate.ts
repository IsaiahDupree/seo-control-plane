import { callLLM, selectModel, type LLMResponse } from '@/lib/llm'
import { createAdminClient } from '@/lib/supabase'

export interface BriefInput {
  appId: string
  focusKeyword: string
  secondaryKeywords: string[]
  contentType: string
  clusterName: string
  targetWordCount: number
  targetPersona: string
  toneNotes: string
  ctaGuidance: string
  appContext: {
    description: string
    targetPersonas: string[]
    brandVoice?: string
    features?: string[]
    prohibitedPhrases?: string[]
  }
  serpAnalysis?: {
    paaQuestions?: string[]
    informationGaps?: string[]
    averageWordCount?: number
    topResultTitles?: string[]
  }
}

export interface GenerationResult {
  title: string
  metaTitle: string
  metaDescription: string
  slug: string
  contentHtml: string
  contentMarkdown: string
  tableOfContents: TOCItem[]
  tags: string[]
  wordCount: number
  readingTimeMinutes: number
  totalTokens: number
  costUsd: number
  llmModel: string
  llmProvider: string
}

export interface TOCItem {
  level: 2 | 3
  text: string
  anchor: string
}

export async function generateArticle(brief: BriefInput): Promise<GenerationResult> {
  const model = selectModel(brief.contentType)

  // Step 1: Generate title + outline
  const outlineRes = await generateOutline(brief, model)

  // Step 2: Generate section-by-section content
  const { sections, sectionTokens, sectionCost } = await generateSections(brief, outlineRes.outline, model)

  // Step 3: Assemble full article
  const assembled = assembleArticle(outlineRes, sections, brief)

  const totalTokens =
    outlineRes.llm.input_tokens +
    outlineRes.llm.output_tokens +
    sectionTokens
  const totalCost = outlineRes.llm.cost_usd + sectionCost

  return {
    ...assembled,
    totalTokens,
    costUsd: totalCost,
    llmModel: model,
    llmProvider: outlineRes.llm.provider,
  }
}

export interface OutlineResult {
  title: string
  metaTitle: string
  metaDescription: string
  slug: string
  h2s: string[]
  outline: string
  llm: LLMResponse
}

async function generateOutline(brief: BriefInput, model: string): Promise<OutlineResult> {
  const systemPrompt = buildSystemPrompt(brief)
  const userPrompt = `Generate a detailed SEO article outline for:

Focus Keyword: "${brief.focusKeyword}"
Content Type: ${brief.contentType}
Target Word Count: ${brief.targetWordCount}
Target Persona: ${brief.targetPersona}
${brief.serpAnalysis?.paaQuestions?.length ? `PAA Questions to address:\n${brief.serpAnalysis.paaQuestions.slice(0, 5).map(q => `- ${q}`).join('\n')}` : ''}
${brief.serpAnalysis?.informationGaps?.length ? `Information gaps vs competitors:\n${brief.serpAnalysis.informationGaps.slice(0, 3).map(g => `- ${g}`).join('\n')}` : ''}

Return JSON only with this exact shape:
{
  "title": "full article title",
  "meta_title": "SEO meta title (max 60 chars)",
  "meta_description": "SEO meta description (max 155 chars)",
  "slug": "url-friendly-slug",
  "h2_sections": ["H2 heading 1", "H2 heading 2", "..."],
  "outline_markdown": "# Title\\n\\n## H2 1\\n- point\\n..."
}`

  const res = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    model as Parameters<typeof callLLM>[1],
    1200
  )

  let parsed: { title: string; meta_title: string; meta_description: string; slug: string; h2_sections: string[]; outline_markdown: string }
  try {
    const jsonMatch = res.text.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { title: brief.focusKeyword, meta_title: brief.focusKeyword, meta_description: '', slug: slugify(brief.focusKeyword), h2_sections: ['Introduction', 'Main Points', 'Conclusion'], outline_markdown: '' }
  } catch {
    parsed = { title: brief.focusKeyword, meta_title: brief.focusKeyword, meta_description: '', slug: slugify(brief.focusKeyword), h2_sections: ['Introduction', 'Main Points', 'Conclusion'], outline_markdown: '' }
  }

  return {
    title: parsed.title,
    metaTitle: parsed.meta_title,
    metaDescription: parsed.meta_description,
    slug: parsed.slug || slugify(brief.focusKeyword),
    h2s: parsed.h2_sections ?? [],
    outline: parsed.outline_markdown ?? '',
    llm: res,
  }
}

async function generateSections(
  brief: BriefInput,
  outline: string,
  model: string
): Promise<{ sections: Record<string, string>; sectionTokens: number; sectionCost: number }> {
  // Parse H2s from outline
  const h2Matches = outline.match(/^## .+/gm) ?? []
  const h2s = h2Matches.map((h) => h.replace(/^## /, '').trim())

  if (h2s.length === 0) {
    // Fallback: generate whole article at once
    const res = await callLLM(
      [
        { role: 'system', content: buildSystemPrompt(brief) },
        { role: 'user', content: buildFullArticlePrompt(brief, outline) },
      ],
      model as Parameters<typeof callLLM>[1],
      4096
    )
    return {
      sections: { full: res.text },
      sectionTokens: res.input_tokens + res.output_tokens,
      sectionCost: res.cost_usd,
    }
  }

  const sections: Record<string, string> = {}
  let totalTokens = 0
  let totalCost = 0

  // Generate each H2 section independently for quality
  const targetWordsPerSection = Math.floor(brief.targetWordCount / (h2s.length + 1))

  for (const h2 of h2s) {
    const prompt = `Write the "${h2}" section of the article about "${brief.focusKeyword}".

Requirements:
- Target ~${targetWordsPerSection} words for this section
- Write in ${brief.toneNotes || 'professional, helpful'} tone
- Naturally include the focus keyword and related terms
- Use H3 subheadings where appropriate
- Write for: ${brief.targetPersona}
- App context: ${brief.appContext.description}

Return only the section HTML starting with the <h2> tag.`

    const res = await callLLM(
      [
        { role: 'system', content: buildSystemPrompt(brief) },
        { role: 'user', content: prompt },
      ],
      model as Parameters<typeof callLLM>[1],
      Math.min(4096, Math.max(500, targetWordsPerSection * 2))
    )

    sections[h2] = res.text
    totalTokens += res.input_tokens + res.output_tokens
    totalCost += res.cost_usd
  }

  return { sections, sectionTokens: totalTokens, sectionCost: totalCost }
}

export function assembleArticle(
  outline: OutlineResult,
  sections: Record<string, string>,
  brief: BriefInput
): Omit<GenerationResult, 'totalTokens' | 'costUsd' | 'llmModel' | 'llmProvider'> {
  let contentHtml = ''

  if (sections.full) {
    contentHtml = sections.full
  } else {
    for (const [, sectionHtml] of Object.entries(sections)) {
      contentHtml += sectionHtml + '\n\n'
    }
  }

  // Build TOC from H2/H3 headings
  const toc = extractTOC(contentHtml)

  // Simple markdown conversion (H tags only — full conversion would use a lib)
  const contentMarkdown = htmlToSimpleMarkdown(contentHtml)

  const wordCount = contentMarkdown.split(/\s+/).filter(Boolean).length
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 200))

  const tags = [
    brief.focusKeyword,
    brief.clusterName,
    brief.contentType,
    ...brief.secondaryKeywords.slice(0, 3),
  ].filter(Boolean)

  return {
    title: outline.title,
    metaTitle: outline.metaTitle,
    metaDescription: outline.metaDescription,
    slug: outline.slug,
    contentHtml,
    contentMarkdown,
    tableOfContents: toc,
    tags: [...new Set(tags)],
    wordCount,
    readingTimeMinutes,
  }
}

function buildSystemPrompt(brief: BriefInput): string {
  const { appContext } = brief
  return `You are an expert SEO content writer. You write for: ${appContext.description}.

Brand voice: ${appContext.brandVoice ?? 'professional, helpful, and authoritative'}
Target personas: ${appContext.targetPersonas.join(', ')}
${appContext.features?.length ? `Key product features to reference naturally: ${appContext.features.slice(0, 5).join(', ')}` : ''}
${appContext.prohibitedPhrases?.length ? `Do NOT use these phrases: ${appContext.prohibitedPhrases.join(', ')}` : ''}

Writing rules:
- Every article must have genuine information gain over existing content
- Use specific examples, data points, and actionable advice
- Write in clear, conversational prose — no corporate jargon
- Do not keyword-stuff; use the focus keyword naturally
- Format for web: short paragraphs, bullet points where useful, H2/H3 structure
- Output clean HTML with semantic heading tags`
}

function buildFullArticlePrompt(brief: BriefInput, outline: string): string {
  return `Write a complete ${brief.targetWordCount}-word SEO article about "${brief.focusKeyword}".

Outline to follow:
${outline}

Requirements:
- Target ${brief.targetWordCount} words
- Include focus keyword "${brief.focusKeyword}" naturally throughout
- Address these secondary keywords: ${brief.secondaryKeywords.join(', ')}
- Write for: ${brief.targetPersona}
- ${brief.toneNotes ? `Tone: ${brief.toneNotes}` : ''}
- ${brief.ctaGuidance ? `CTA context: ${brief.ctaGuidance}` : ''}

Output clean HTML with semantic tags (h2, h3, p, ul, li, strong).`
}

export function extractTOC(html: string): TOCItem[] {
  const toc: TOCItem[] = []
  const headingRegex = /<(h2|h3)[^>]*>(.*?)<\/(h2|h3)>/gi
  let match
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1].replace('h', '')) as 2 | 3
    const text = match[2].replace(/<[^>]+>/g, '').trim()
    const anchor = slugify(text)
    toc.push({ level, text, anchor })
  }
  return toc
}

export function htmlToSimpleMarkdown(html: string): string {
  return html
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s.slice(0, 80).replace(/-+$/g, '')
}

export type ArticleSaveMeta = {
  focusKeyword: string
  secondaryKeywords: string[]
  contentType: string
  clusterName?: string
}

export async function saveGeneratedArticle(
  appId: string,
  briefId: string | null,
  contentRequestId: string | null,
  result: GenerationResult,
  meta: ArticleSaveMeta
): Promise<string> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('scp_articles')
    .insert({
      app_id: appId,
      brief_id: briefId,
      content_request_id: contentRequestId,
      slug: result.slug,
      title: result.title,
      description: result.metaDescription,
      meta_title: result.metaTitle,
      meta_description: result.metaDescription,
      content_html: result.contentHtml,
      content_markdown: result.contentMarkdown,
      body_mdx: result.contentMarkdown,
      focus_keyword: meta.focusKeyword,
      secondary_keywords: meta.secondaryKeywords,
      content_type: meta.contentType,
      cluster_name: meta.clusterName ?? null,
      table_of_contents: result.tableOfContents,
      tags: result.tags,
      word_count: result.wordCount,
      reading_time_minutes: result.readingTimeMinutes,
      status: 'qa_pending',
      llm_model: result.llmModel,
      llm_provider: result.llmProvider,
      generation_cost_usd: result.costUsd,
      generation_tokens: result.totalTokens,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to save article')
  return data.id
}
