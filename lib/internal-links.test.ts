import { afterEach, describe, expect, it, vi } from 'vitest'

const mockCreateAdminClient = vi.fn()

vi.mock('@/lib/supabase', () => ({
  createAdminClient: () => mockCreateAdminClient(),
}))

import {
  applyInternalLinks,
  injectLinksIntoHtml,
  saveInternalLinkEdges,
  suggestInternalLinks,
  type LinkSuggestion,
} from './internal-links'

function link(overrides: Partial<LinkSuggestion> = {}): LinkSuggestion {
  return {
    target_article_id: 't1',
    target_slug: 'target',
    anchor_text: 'example phrase',
    target_url: 'https://app.example/blog/target',
    relevance_score: 2,
    matched_keyword: 'example phrase',
    ...overrides,
  }
}

function mockIndexClient(opts: {
  baseUrl?: string
  articles: Array<Record<string, unknown>>
}) {
  return {
    from: vi.fn((t: string) => {
      if (t === 'scp_apps') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { base_url: opts.baseUrl ?? 'https://site.example' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (t === 'scp_articles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                then(
                  onF?: (v: { data: unknown; error: unknown }) => unknown,
                  onR?: (r: unknown) => unknown
                ) {
                  return Promise.resolve({
                    data: opts.articles,
                    error: null,
                  }).then(onF, onR)
                },
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${t}`)
    }),
  }
}

describe('injectLinksIntoHtml', () => {
  it('returns original html when links array is empty', () => {
    const html = '<p>Hello world</p>'
    expect(injectLinksIntoHtml(html, [])).toBe(html)
  })

  it('wraps first occurrence of anchor text in an anchor tag', () => {
    const html = '<p>Read example phrase here</p>'
    const out = injectLinksIntoHtml(html, [link()])
    expect(out).toContain('<a href="https://app.example/blog/target"')
    expect(out).toContain('data-internal-link="true"')
    expect(out).toContain('>example phrase</a>')
  })

  it('handles multiple distinct links', () => {
    const html = '<p>alpha and beta end</p>'
    const out = injectLinksIntoHtml(html, [
      link({ anchor_text: 'alpha', target_url: 'https://x/a', target_slug: 'a' }),
      link({ anchor_text: 'beta', target_url: 'https://x/b', target_slug: 'b' }),
    ])
    expect(out).toMatch(/<a[^>]+>alpha<\/a>/)
    expect(out).toMatch(/<a[^>]+>beta<\/a>/)
  })

  it('escapes regex metacharacters in anchor text', () => {
    const html = '<p>see a+b=c for details</p>'
    const out = injectLinksIntoHtml(html, [
      link({
        anchor_text: 'a+b',
        target_url: 'https://x/p',
        target_slug: 'p',
      }),
    ])
    expect(out).toContain('href="https://x/p"')
    expect(out).toContain('a+b</a>')
  })

  it('is case-insensitive for matching', () => {
    const html = '<p>UPPERCASE PHRASE</p>'
    const out = injectLinksIntoHtml(html, [
      link({ anchor_text: 'uppercase phrase', target_slug: 's' }),
    ])
    expect(out.toLowerCase()).toContain('uppercase phrase</a>')
  })
})

describe('suggestInternalLinks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('excludes source article and prefers longer keyword phrases', async () => {
    mockCreateAdminClient.mockReturnValue(
      mockIndexClient({
        articles: [
          {
            id: 'src',
            slug: 'source',
            title: 'S',
            focus_keyword: 'noise',
            secondary_keywords: [],
            tags: [],
            status: 'published',
          },
          {
            id: 't1',
            slug: 'other',
            title: 'O',
            focus_keyword: 'long tail phrase',
            secondary_keywords: ['tail'],
            tags: [],
            status: 'published',
          },
        ],
      })
    )
    const text = 'this long tail phrase beats plain tail in scoring'
    const suggestions = await suggestInternalLinks('app-1', 'src', text, 5)
    expect(suggestions.map((s) => s.target_article_id)).toEqual(['t1'])
    expect(suggestions[0].matched_keyword).toBe('long tail phrase')
    expect(suggestions[0].relevance_score).toBe(3)
    expect(suggestions[0].target_url).toBe('https://site.example/blog/other')
  })

  it('respects maxLinks', async () => {
    mockCreateAdminClient.mockReturnValue(
      mockIndexClient({
        articles: [
          { id: 'a1', slug: 'p1', title: 'A', focus_keyword: 'one', secondary_keywords: [], tags: [], status: 'published' },
          { id: 'a2', slug: 'p2', title: 'B', focus_keyword: 'two', secondary_keywords: [], tags: [], status: 'published' },
          { id: 'a3', slug: 'p3', title: 'C', focus_keyword: 'three', secondary_keywords: [], tags: [], status: 'published' },
        ],
      })
    )
    const text = 'one two three here'
    const suggestions = await suggestInternalLinks('app-1', 'src', text, 2)
    expect(suggestions).toHaveLength(2)
  })
})

describe('saveInternalLinkEdges', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not touch the database when links is empty', async () => {
    await saveInternalLinkEdges('app-1', 'art-1', [])
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })

  it('upserts rows for each suggestion', async () => {
    const upsert = vi.fn().mockReturnValue({
      then(onF?: (v: { error: unknown }) => unknown, onR?: (r: unknown) => unknown) {
        return Promise.resolve({ error: null }).then(onF, onR)
      },
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_internal_link_edges') {
          return { upsert }
        }
        throw new Error(`unexpected ${t}`)
      }),
    })
    const suggestions: LinkSuggestion[] = [
      {
        target_article_id: 'to-1',
        target_slug: 'slug',
        anchor_text: 'kw',
        target_url: 'https://x/blog/slug',
        relevance_score: 2,
        matched_keyword: 'kw',
      },
    ]
    await saveInternalLinkEdges('app-1', 'from-1', suggestions)
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          app_id: 'app-1',
          from_article_id: 'from-1',
          to_article_id: 'to-1',
          to_slug: 'slug',
          anchor_text: 'kw',
          semantic_score: 2,
          inserted_by: 'generation',
        }),
      ],
      { onConflict: 'from_article_id,to_article_id' }
    )
  })
})

describe('applyInternalLinks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns original html when no suggestions', async () => {
    mockCreateAdminClient.mockReturnValue(
      mockIndexClient({
        articles: [],
      })
    )
    const html = '<p>only local text</p>'
    const out = await applyInternalLinks('app-1', 'art-1', html, 'only local text')
    expect(out.html).toBe(html)
    expect(out.links).toEqual([])
  })

  it('injects anchors and saves edges when suggestions exist', async () => {
    const upsert = vi.fn().mockReturnValue({
      then(onF?: (v: { error: unknown }) => unknown, onR?: (r: unknown) => unknown) {
        return Promise.resolve({ error: null }).then(onF, onR)
      },
    })
    const indexClient = mockIndexClient({
      articles: [
        {
          id: 'target-1',
          slug: 'tgt',
          title: 'T',
          focus_keyword: 'magic word',
          secondary_keywords: [],
          tags: [],
          status: 'published',
        },
      ],
    })
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'scp_internal_link_edges') {
          return { upsert }
        }
        return indexClient.from(t)
      }),
    })
    const html = '<p>prefix magic word suffix</p>'
    const out = await applyInternalLinks('app-1', 'source-1', html, 'prefix magic word suffix')
    expect(out.links).toHaveLength(1)
    expect(out.links[0].target_slug).toBe('tgt')
    expect(out.html).toContain('data-internal-link="true"')
    expect(out.html).toContain('magic word</a>')
    expect(upsert).toHaveBeenCalled()
  })
})
