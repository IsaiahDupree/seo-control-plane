import { describe, expect, it } from 'vitest'
import { buildThenableFluentChain } from './supabase-mocks'

describe('buildThenableFluentChain', () => {
  it('creates fluent methods that return the same chain', async () => {
    const chain = buildThenableFluentChain(
      ['select', 'eq', 'order', 'limit'],
      { data: [1], error: null }
    )

    expect(chain.select()).toBe(chain)
    expect(chain.eq('app_id', 'x')).toBe(chain)
    expect(chain.order('created_at', { ascending: false })).toBe(chain)
    expect(chain.limit(10)).toBe(chain)

    const res = await chain
    expect(res).toEqual({ data: [1], error: null })
  })

  it('works with an empty method list (thenable only)', async () => {
    const chain = buildThenableFluentChain([], { ok: true })
    const res = await chain
    expect(res).toEqual({ ok: true })
  })
})

