import { describe, expect, it } from 'vitest'
import {
  ARTICLE_STATUS_LIST,
  KEYWORD_STATUS_LIST,
  patchArticleBody,
  patchContentRequestBody,
  patchKeywordBody,
  publishConfirmBody,
} from '@/lib/schemas'

describe('patchArticleBody', () => {
  it('accepts published status', () => {
    const r = patchArticleBody.safeParse({ status: 'published' })
    expect(r.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const r = patchArticleBody.safeParse({ status: 'article_live' })
    expect(r.success).toBe(false)
  })

  it('rejects empty patch', () => {
    const r = patchArticleBody.safeParse({})
    expect(r.success).toBe(false)
  })
})

describe('patchKeywordBody', () => {
  it('accepts published', () => {
    expect(patchKeywordBody.safeParse({ status: 'published' }).success).toBe(true)
  })

  it('rejects invalid status', () => {
    expect(patchKeywordBody.safeParse({ status: 'draft' }).success).toBe(false)
  })
})

describe('status lists', () => {
  it('article list includes published not legacy typo', () => {
    expect(ARTICLE_STATUS_LIST).toContain('published')
    expect(ARTICLE_STATUS_LIST).not.toContain('article_live' as never)
  })

  it('keyword list matches schema', () => {
    expect(KEYWORD_STATUS_LIST).toEqual([
      'unassigned',
      'brief_created',
      'assigned',
      'published',
    ])
  })
})

describe('patchContentRequestBody', () => {
  it('requires at least one field', () => {
    expect(patchContentRequestBody.safeParse({}).success).toBe(false)
  })

  it('accepts cancelled', () => {
    expect(patchContentRequestBody.safeParse({ status: 'cancelled' }).success).toBe(
      true
    )
  })
})

describe('publishConfirmBody', () => {
  it('requires uuid article_id', () => {
    const bad = publishConfirmBody.safeParse({
      article_id: 'not-a-uuid',
      slug: 'hello',
    })
    expect(bad.success).toBe(false)
    const ok = publishConfirmBody.safeParse({
      article_id: '550e8400-e29b-41d4-a716-446655440000',
      slug: 'hello',
    })
    expect(ok.success).toBe(true)
  })
})
