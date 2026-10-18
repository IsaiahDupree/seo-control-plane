import { vi } from 'vitest'

/**
 * Generic thenable fluent chain builder for Supabase-style mocks.
 *
 * - Every listed method is a `vi.fn()` that returns the chain itself.
 * - The chain is "awaitable" via `.then(...)`, resolving to `result`.
 *
 * Use when the real route awaits the chain directly:
 * `const { data, error } = await admin.from(...).select(...).eq(...).limit(...)`
 */
export function buildThenableFluentChain<Result extends object>(
  methods: string[],
  result: Result
) {
  const resolved = Promise.resolve(result)

  type ThenFn = (
    onF?: (v: Result) => unknown,
    onR?: (reason: unknown) => unknown
  ) => Promise<unknown>

  const chain: Record<string, unknown> & { then: ThenFn } = {
    then(onF, onR) {
      return resolved.then(onF, onR)
    },
  }

  for (const m of methods) {
    ;(chain as Record<string, unknown>)[m] = vi.fn()
    ;(chain as Record<string, ReturnType<typeof vi.fn>>)[m as string].mockReturnValue(chain)
  }

  return chain as typeof chain & Record<string, ReturnType<typeof vi.fn>>
}

/**
 * Minimal Supabase client mock: `from(t).insert().select().single()` resolves to `{ data, error }`.
 */
export function createClientWithInsertSingle<T>(
  table: string,
  data: T | null,
  error: unknown
) {
  return {
    from: vi.fn((t: string) => {
      if (t !== table) throw new Error(`Expected table ${table}, got ${t}`)
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data, error }),
          }),
        }),
      }
    }),
  }
}

/** Fluent chain: `.select().eq()....limit()` → `Promise.resolve(queryResult)`. */
export function buildArticleScheduleSelectChain(queryResult: {
  data: unknown
  error: unknown
}) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.is.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.in.mockReturnValue(chain)
  chain.limit.mockResolvedValue(queryResult)
  return chain
}

/**
 * Fluent chain for `scp_articles` schedule query through `.limit()` (terminal promise).
 */
export function createClientWithArticleScheduleQuery(queryResult: {
  data: unknown
  error: unknown
}) {
  return {
    from: vi.fn((t: string) => {
      if (t !== 'scp_articles') throw new Error(`Unexpected table ${t}`)
      return buildArticleScheduleSelectChain(queryResult)
    }),
  }
}

/**
 * Full happy path for `content/schedule`: select approved articles, clear pending queue rows,
 * update each article, insert publish_queue rows.
 */
export function createClientForSchedulePublishSuccess(
  articleId: string,
  queueRowId: string
) {
  const selectChain = buildArticleScheduleSelectChain({
    data: [{ id: articleId }],
    error: null,
  })
  let articlesFrom = 0
  let queueFrom = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_articles') {
        articlesFrom += 1
        if (articlesFrom === 1) return selectChain
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }
      if (table === 'scp_publish_queue') {
        queueFrom += 1
        if (queueFrom === 1) {
          return {
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: queueRowId }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

/**
 * Schedule flow: candidates found, then `scp_publish_queue` delete fails.
 */
export function createClientForScheduleQueueClearFailure(
  articleId: string,
  deleteMessage: string
) {
  const selectChain = buildArticleScheduleSelectChain({
    data: [{ id: articleId }],
    error: null,
  })
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_articles') return selectChain
      if (table === 'scp_publish_queue') {
        return {
          delete: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: deleteMessage } }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

/**
 * Candidates found, queue clear OK, first `scp_articles` update fails.
 */
export function createClientForScheduleArticleUpdateFailure(
  articleId: string,
  updateMessage: string
) {
  const selectChain = buildArticleScheduleSelectChain({
    data: [{ id: articleId }],
    error: null,
  })
  let articlesFrom = 0
  let queueFrom = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_articles') {
        articlesFrom += 1
        if (articlesFrom === 1) return selectChain
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: { message: updateMessage } }),
            }),
          }),
        }
      }
      if (table === 'scp_publish_queue') {
        queueFrom += 1
        if (queueFrom === 1) {
          return {
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

/**
 * Select + queue clear + article update OK; `publish_queue.insert().single()` fails.
 */
export function createClientForScheduleQueueInsertFailure(
  articleId: string,
  insertMessage: string
) {
  const selectChain = buildArticleScheduleSelectChain({
    data: [{ id: articleId }],
    error: null,
  })
  let articlesFrom = 0
  let queueFrom = 0
  return {
    from: vi.fn((table: string) => {
      if (table === 'scp_articles') {
        articlesFrom += 1
        if (articlesFrom === 1) return selectChain
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }
      if (table === 'scp_publish_queue') {
        queueFrom += 1
        if (queueFrom === 1) {
          return {
            delete: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: insertMessage },
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

/**
 * Fluent chain: `.select().eq()....in()?.order().range()` then optional `.eq()` / `.in()` → awaitable `{ data, error }`.
 * Matches list-style Supabase queries (publish-logs, audit-log, deliveries, articles, content queue).
 */
export function buildSelectEqOrderRangeChain(queryResult: {
  data: unknown
  error: unknown
}) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then(
      onF?: (v: typeof queryResult) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(queryResult).then(onF, onR)
    },
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.in.mockReturnValue(b)
  b.gte.mockReturnValue(b)
  b.lte.mockReturnValue(b)
  b.order.mockReturnValue(b)
  b.range.mockReturnValue(b)
  return b
}

/**
 * Fluent chain: `.select().eq().order().limit().gte()?.lte()?` → awaitable `{ data, error }`.
 * Matches GSC performance list (date filters optional after limit).
 */
export function buildSelectEqOrderLimitChain(queryResult: {
  data: unknown
  error: unknown
}) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    then(
      onF?: (v: typeof queryResult) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(queryResult).then(onF, onR)
    },
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.order.mockReturnValue(b)
  b.limit.mockReturnValue(b)
  b.gte.mockReturnValue(b)
  b.lte.mockReturnValue(b)
  return b
}

/**
 * Fluent chain ending at `.order()` (no `.range()`): `.select().eq().order()` → awaitable `{ data, error }`.
 */
export function buildSelectEqOrderChain(queryResult: {
  data: unknown
  error: unknown
}) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then(
      onF?: (v: typeof queryResult) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(queryResult).then(onF, onR)
    },
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.order.mockReturnValue(b)
  return b
}

/**
 * Head count: `.select(..., { count: 'exact', head: true }).eq().is()` → awaitable `{ count, error }`.
 */
export function buildHeadCountChain(result: { count: number | null; error: unknown }) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.is.mockReturnValue(b)
  return b
}

/** `.select().eq().eq().maybeSingle()` → Promise `{ data, error }`. */
export function buildSelectEqEqMaybeSingleChain(row: {
  data: unknown
  error: unknown
}) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(row),
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  return b
}

/** `.select().eq().eq().single()` → Promise `{ data, error }`. */
export function buildSelectEqEqSingleChain(row: { data: unknown; error: unknown }) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(row),
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  return b
}

/** `.select().eq().eq().eq().single()` → Promise `{ data, error }`. */
export function buildSelectEqEqEqSingleChain(row: { data: unknown; error: unknown }) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(row),
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  return b
}

/** `.select().eq().single()` (one filter) → Promise `{ data, error }`. */
export function buildSelectEqSingleChain(row: { data: unknown; error: unknown }) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue(row),
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  return b
}

/** `.select().eq().not(...)` → awaitable `{ data, error }` (e.g. cluster_name not null). */
export function buildSelectEqNotChain(result: { data: unknown; error: unknown }) {
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.not.mockReturnValue(b)
  return b
}

/** `.update().eq()` → awaitable `{ error }` (single `.eq()`, no `.select()`). */
export function buildUpdateEqThenChain(result: { error: unknown }) {
  const terminal = {
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue(terminal),
    }),
  }
}

/** `.update().eq().eq()` → awaitable `{ error }` (no `.select()`). */
export function buildUpdateEqEqThenChain(result: { error: unknown }) {
  const b = {
    update: vi.fn(),
    eq: vi.fn(),
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  b.update.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  return b
}

/** `.update().eq().eq().is()` → awaitable `{ error }` (Supabase update result shape). */
export function buildUpdateEqEqIsChain(result: { error: unknown }) {
  const b = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    then(
      onF?: (v: typeof result) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(result).then(onF, onR)
    },
  }
  b.update.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.is.mockReturnValue(b)
  return b
}

/**
 * Refresh queue list: `.select(..., { count }).eq()....order().order().range()` → `{ data, error, count }`.
 */
export function buildRefreshListChain(result: {
  data: unknown
  error: unknown
  count?: number | null
}) {
  const payload = {
    data: result.data,
    error: result.error,
    count: result.count ?? null,
  }
  const terminal = {
    then(
      onF?: (v: typeof payload) => unknown,
      onR?: (reason: unknown) => unknown
    ) {
      return Promise.resolve(payload).then(onF, onR)
    },
  }
  const b = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  }
  b.select.mockReturnValue(b)
  b.eq.mockReturnValue(b)
  b.order.mockReturnValue(b)
  b.range.mockReturnValue(terminal)
  return b
}

/** `.update().eq().select().single()` → Promise `{ data, error }`. */
export function buildUpdateEqSelectSingleChain(result: {
  data: unknown
  error: unknown
}) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(result),
        }),
      }),
    }),
  }
}

/** `.update().eq().eq().select().single()` → Promise `{ data, error }`. */
export function buildUpdateEqEqSelectSingleChain(result: {
  data: unknown
  error: unknown
}) {
  return {
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(result),
          }),
        }),
      }),
    }),
  }
}
