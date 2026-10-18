import { describe, expect, it } from 'vitest'
import type { LLMResponse } from '@/lib/llm'
import {
  assembleArticle,
  extractTOC,
  htmlToSimpleMarkdown,
  slugify,
  type BriefInput,
  type OutlineResult,
} from './generate'

const dummyLlm: LLMResponse = {
  text: '{}',
  input_tokens: 1,
  output_tokens: 2,
  model: 'gpt-4o-mini',
  provider: 'openai',
  cost_usd: 0,
}

function outlineStub(overrides: Partial<OutlineResult> = {}): OutlineResult {
  return {
    title: 'Article Title',
    metaTitle: 'Meta Title',
    metaDescription: 'Meta description for the article.',
    slug: 'article-slug',
    h2s: [],
    outline: '',
    llm: dummyLlm,
    ...overrides,
  }
}

function minimalBrief(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    appId: 'app-1',
    focusKeyword: 'focus kw',
    secondaryKeywords: ['s1', 's2', 's3', 's4'],
    contentType: 'guide',
    clusterName: 'cluster-a',
    targetWordCount: 800,
    targetPersona: 'builders',
    toneNotes: '',
    ctaGuidance: '',
    appContext: { description: 'Product', targetPersonas: ['devs'] },
    ...overrides,
  }
}

describe('slugify', () => {
  it('trims input, lowercases, and replaces inner spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world')
    expect(slugify('  Foo   Bar  ')).toBe('foo-bar')
  })

  it('strips leading and trailing hyphens from the result', () => {
    expect(slugify('---foo--bar---')).toBe('foo-bar')
  })

  it('strips punctuation and collapses hyphen runs', () => {
    expect(slugify('A & B!!!')).toBe('a-b')
    expect(slugify('foo---bar')).toBe('foo-bar')
  })

  it('keeps underscores as word characters', () => {
    expect(slugify('snake_case title')).toBe('snake_case-title')
  })

  it('truncates to 80 characters and avoids a trailing hyphen after cut', () => {
    const long = 'word '.repeat(30)
    const s = slugify(long)
    expect(s.length).toBeLessThanOrEqual(80)
    expect(s.startsWith('word-word-word')).toBe(true)
    expect(s.endsWith('-')).toBe(false)
  })

  it('returns empty string for empty or whitespace-only input', () => {
    expect(slugify('')).toBe('')
    expect(slugify('   \t  ')).toBe('')
  })
})

describe('extractTOC', () => {
  it('collects h2 and h3 with stripped inner tags and slug anchors', () => {
    const html = `
      <h2>First <strong>Section</strong></h2>
      <p>x</p>
      <h3>Sub &amp; note</h3>
    `
    const toc = extractTOC(html)
    expect(toc).toEqual([
      { level: 2, text: 'First Section', anchor: 'first-section' },
      { level: 3, text: 'Sub &amp; note', anchor: 'sub-amp-note' },
    ])
  })

  it('returns empty array when no headings', () => {
    expect(extractTOC('<p>no headings</p>')).toEqual([])
  })
})

describe('htmlToSimpleMarkdown', () => {
  it('converts headings, emphasis, list items, and strips other tags', () => {
    const html = '<h2>Title</h2><p>Para with <strong>bold</strong> and <em>it</em>.</p><ul><li>One</li></ul>'
    const md = htmlToSimpleMarkdown(html)
    expect(md).toContain('## Title')
    expect(md).toContain('**bold**')
    expect(md).toContain('*it*')
    expect(md).toContain('- One')
    expect(md).not.toContain('<p>')
    expect(md).not.toContain('<ul>')
  })

  it('collapses excessive newlines', () => {
    const html = '<h2>A</h2>\n\n\n\n<h2>B</h2>'
    const md = htmlToSimpleMarkdown(html)
    expect(md.split('\n\n').length).toBeLessThanOrEqual(4)
  })
})

describe('assembleArticle', () => {
  it('uses sections.full as HTML when present', () => {
    const html = '<h2>One</h2><p>alpha beta gamma delta</p>'
    const out = assembleArticle(outlineStub(), { full: html }, minimalBrief())

    expect(out.contentHtml).toBe(html)
    expect(out.title).toBe('Article Title')
    expect(out.slug).toBe('article-slug')
    expect(out.metaTitle).toBe('Meta Title')
    expect(out.wordCount).toBeGreaterThanOrEqual(4)
    expect(out.readingTimeMinutes).toBeGreaterThanOrEqual(1)
    expect(out.tableOfContents.length).toBeGreaterThanOrEqual(1)
  })

  it('concatenates per-section HTML when full is absent', () => {
    const out = assembleArticle(
      outlineStub(),
      {
        Intro: '<h2>Intro</h2><p>x</p>',
        Body: '<h2>Body</h2><p>a b c</p>',
      },
      minimalBrief()
    )

    expect(out.contentHtml).toContain('<h2>Intro</h2>')
    expect(out.contentHtml).toContain('<h2>Body</h2>')
  })

  it('dedupes tags and caps secondary keywords at three', () => {
    const out = assembleArticle(
      outlineStub(),
      { full: '<h2>H</h2><p>one two three four five</p>' },
      minimalBrief({
        focusKeyword: 'k',
        clusterName: 'c',
        contentType: 'guide',
        secondaryKeywords: ['s1', 's2', 's3', 's4'],
      })
    )

    expect(out.tags).toEqual(['k', 'c', 'guide', 's1', 's2', 's3'])
  })
})
