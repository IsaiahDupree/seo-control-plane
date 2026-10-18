import { z } from 'zod'

export const contentRequestBody = z.object({
  batch_size: z.number().int().min(1).max(100),
  notes: z.string().max(2000).optional(),
})

export const publishConfirmBody = z.object({
  article_id: z.string().uuid(),
  slug: z.string().min(1).max(200),
  published_url: z.string().url().optional(),
  /** ISO-8601 timestamp when the article went live on the base app */
  published_at: z.string().min(1).optional(),
  /**
   * When true, submit canonical URL to IndexNow after publish (needs `metadata.indexnow_key`).
   * Also runs when `metadata.indexnow_on_publish` is true without passing this flag.
   */
  submit_indexnow: z.boolean().optional(),
})

export const ingestEventItem = z.object({
  event_name: z.string().min(1).max(120),
  article_id: z.string().uuid().optional(),
  client_event_id: z.string().max(200).optional(),
  occurred_at: z.string().min(1).optional(),
  payload: z.record(z.string(), z.any()).optional(),
})

export const ingestEventsBody = z.object({
  events: z.array(ingestEventItem).min(1).max(500),
})

export const patchAppSettingsBody = z.object({
  name: z.string().min(1).max(200).optional(),
  base_url: z.union([z.string().url(), z.null()]).optional(),
  domain: z.union([z.string().min(1).max(255), z.null()]).optional(),
  context: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  webhook_url: z.union([z.string().url(), z.null()]).optional(),
  /** When set, replaces webhook signing secret (min 16 chars). Omit to leave unchanged. */
  webhook_secret: z.string().min(16).max(512).optional(),
  /** Cap articles generated per UTC month; ≤0 or ≥10000 treated as unlimited. */
  monthly_article_limit: z.number().int().min(0).max(100000).optional(),
})

export const keywordSeedItem = z.object({
  keyword: z.string().min(1).max(500),
  cluster_name: z.string().max(200).optional(),
  search_volume: z.number().int().nonnegative().optional(),
  difficulty: z.number().int().min(0).max(100).optional(),
  intent: z
    .enum(['informational', 'navigational', 'commercial', 'transactional'])
    .optional(),
  priority_score: z.number().optional(),
  is_seed: z.boolean().optional(),
})

export const keywordsBulkBody = z.object({
  keywords: z.array(keywordSeedItem).min(1).max(500),
})

/** Cancel (`status: cancelled`) or edit notes on an **open** batch request. */
export const patchContentRequestBody = z
  .object({
    status: z.literal('cancelled').optional(),
    notes: z.union([z.string().max(2000), z.null()]).optional(),
  })
  .refine((o) => o.status !== undefined || o.notes !== undefined, {
    message: 'Provide status (cancelled) and/or notes',
  })

export const schedulePublishBody = z.object({
  article_ids: z.array(z.string().uuid()).min(1).max(50).optional(),
  /** Max articles to schedule when article_ids omitted (approved, not yet scheduled). */
  limit: z.number().int().min(1).max(50).optional(),
  /** ISO-8601; default now (UTC). */
  first_publish_at: z.string().min(1).optional(),
  spacing_minutes: z.number().int().min(15).max(24 * 60).default(120),
})

/** IndexNow: https://www.indexnow.org/documentation */
export const indexNowSubmitBody = z.object({
  urls: z.array(z.string().url()).min(1).max(500),
  /** 8–128 chars per IndexNow; omit if `metadata.indexnow_key` is set on the app. */
  key: z.string().min(8).max(128).optional(),
  key_location: z.string().url().optional(),
  /** Defaults to hostname of the first URL. */
  host: z.string().min(1).max(255).optional(),
})

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD')

/** Daily per-article metrics (`scp_article_performance`). */
export const articlePerformanceRowSchema = z.object({
  article_id: z.string().uuid(),
  date: ymd,
  sessions: z.number().int().min(0).default(0),
  pageviews: z.number().int().min(0).default(0),
  avg_scroll_depth: z.number().min(0).max(100).nullable().optional(),
  reads_complete: z.number().int().min(0).default(0),
  cta_clicks: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
  attributed_revenue_usd: z.number().min(0).default(0),
  avg_position: z.number().min(0).nullable().optional(),
  impressions: z.number().int().min(0).default(0),
  clicks: z.number().int().min(0).default(0),
  ctr: z.number().min(0).max(1).nullable().optional(),
})

export const articlePerformanceSyncBody = z.object({
  rows: z.array(articlePerformanceRowSchema).min(1).max(500),
})

export const createExperimentBody = z.object({
  article_id: z.string().uuid(),
  variant_type: z.enum([
    'title',
    'meta_description',
    'cta_text',
    'cta_position',
    'h2_heading',
    'intro_paragraph',
  ]),
  control_value: z.string().min(1).max(4000),
  variant_value: z.string().min(1).max(4000),
})

export const patchExperimentBody = z
  .object({
    status: z.enum(['running', 'paused', 'concluded', 'cancelled']).optional(),
    winner: z.enum(['control', 'variant']).nullable().optional(),
    concluded_at: z.string().min(1).nullable().optional(),
    significance_pct: z.number().min(0).max(100).nullable().optional(),
    control_conversions: z.number().int().min(0).optional(),
    variant_conversions: z.number().int().min(0).optional(),
    control_sessions: z.number().int().min(0).optional(),
    variant_sessions: z.number().int().min(0).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field required' })

export const articleStatusSchema = z.enum([
  'draft',
  'brief_pending',
  'generating',
  'qa_pending',
  'qa_review',
  'approved',
  'queued',
  'delivered',
  'published',
  'archived',
])

export type ArticlePipelineStatus = z.infer<typeof articleStatusSchema>

/** Known article `status` values (dashboards, parallel COUNT queries). */
export const ARTICLE_STATUS_LIST: readonly ArticlePipelineStatus[] = articleStatusSchema.options

/** Operator updates to an article (API key auth; no human user id). */
export const patchArticleBody = z
  .object({
    status: articleStatusSchema.optional(),
    tags: z.array(z.string().min(1).max(120)).max(50).optional(),
    scheduled_publish_at: z.union([z.string().min(1), z.null()]).optional(),
    meta_title: z.string().max(500).optional(),
    meta_description: z.string().max(2000).optional(),
    canonical_url: z.union([z.string().url(), z.null()]).optional(),
    title: z.string().min(1).max(400).optional(),
    description: z.union([z.string().max(2000), z.null()]).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field required' })

export const patchBriefBody = z
  .object({
    status: z.enum(['pending', 'assigned', 'generating', 'complete']).optional(),
    tone_notes: z.string().max(4000).nullable().optional(),
    cta_guidance: z.string().max(4000).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field required' })

export const keywordStatusSchema = z.enum([
  'unassigned',
  'brief_created',
  'assigned',
  'published',
])

export type KeywordPipelineStatus = z.infer<typeof keywordStatusSchema>

export const KEYWORD_STATUS_LIST: readonly KeywordPipelineStatus[] =
  keywordStatusSchema.options

export const patchKeywordBody = z
  .object({
    cluster_name: z.string().max(200).nullable().optional(),
    status: keywordStatusSchema.optional(),
    priority_score: z.number().nullable().optional(),
    is_seed: z.boolean().optional(),
    article_id: z.string().uuid().nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field required' })

export const createApiKeyBody = z.object({
  label: z.string().min(1).max(80).optional(),
})
