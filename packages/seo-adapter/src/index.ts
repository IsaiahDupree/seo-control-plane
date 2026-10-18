export type SeoAdapterOptions = {
  /** Control plane origin, e.g. https://seo.yourdomain.com */
  baseUrl: string
  appId: string
  apiKey: string
}

function base(opts: SeoAdapterOptions) {
  return opts.baseUrl.replace(/\/$/, '')
}

function headers(opts: SeoAdapterOptions): HeadersInit {
  return {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  }
}

/** Thrown when the control plane returns a non-2xx response or non-JSON body. */
export class SeoControlPlaneHttpError extends Error {
  override readonly name = 'SeoControlPlaneHttpError'
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body: unknown = undefined
  ) {
    super(message)
  }
}

export function isSeoControlPlaneHttpError(
  e: unknown
): e is SeoControlPlaneHttpError {
  return e instanceof SeoControlPlaneHttpError
}

function errorFromBody(data: unknown): { message: string; code?: string } {
  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error: unknown }).error === 'object' &&
    (data as { error: object | null }).error !== null
  ) {
    const err = (data as { error: { code?: unknown; message?: unknown } }).error
    const message = typeof err.message === 'string' ? err.message : 'Request failed'
    const code = typeof err.code === 'string' ? err.code : undefined
    return { message, code }
  }
  return { message: 'Request failed' }
}

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new SeoControlPlaneHttpError(
        `Invalid JSON (${res.status}): ${text.slice(0, 200)}`,
        res.status,
        undefined,
        text
      )
    }
  }
  if (!res.ok) {
    const { message, code } = errorFromBody(data)
    throw new SeoControlPlaneHttpError(message, res.status, code, data)
  }
  return data as T
}

/** Bootstrap: create `scp_apps` + default API key (`POST /api/apps/register`). */
export type RegisterSeoControlPlaneAppParams = {
  baseUrl: string
  registerSecret: string
  slug: string
  name: string
  base_url?: string
  webhook_url?: string
  context?: Record<string, unknown>
}

export type RegisterSeoControlPlaneAppResult = {
  app: { id: string; slug: string; name: string }
  api_key: string
  message: string
  /** Present if `scp_user_audit_log` insert failed after successful provisioning. */
  audit_warning?: string
}

export async function registerSeoControlPlaneApp(
  params: RegisterSeoControlPlaneAppParams
): Promise<RegisterSeoControlPlaneAppResult> {
  const root = params.baseUrl.replace(/\/$/, '')
  const res = await fetch(`${root}/api/apps/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: params.slug,
      name: params.name,
      base_url: params.base_url,
      webhook_url: params.webhook_url,
      context: params.context,
      register_secret: params.registerSecret,
    }),
  })
  return parseResponse<RegisterSeoControlPlaneAppResult>(res)
}

export function createSeoControlPlaneClient(opts: SeoAdapterOptions) {
  const root = `${base(opts)}/api/v1/apps/${opts.appId}`

  async function fetchDashboardGaps<T = unknown>() {
    const res = await fetch(`${root}/dashboard/gaps`, { headers: headers(opts) })
    return parseResponse<T>(res)
  }

  return {
    async requestContent(batch_size: number, notes?: string) {
      const res = await fetch(`${root}/content/request`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ batch_size, notes }),
      })
      return parseResponse(res)
    },

    async getQueue(options?: { limit?: number; offset?: number; full?: boolean }) {
      const sp = new URLSearchParams()
      if (options?.limit != null) sp.set('limit', String(options.limit))
      if (options?.offset != null) sp.set('offset', String(options.offset))
      if (options?.full) sp.set('full', '1')
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/content/queue${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async getSettings() {
      const res = await fetch(`${root}/settings`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listApiKeys() {
      const res = await fetch(`${root}/api-keys`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async createApiKey(body?: { label?: string }) {
      const res = await fetch(`${root}/api-keys`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body ?? {}),
      })
      return parseResponse(res)
    },

    async revokeApiKey(keyId: string) {
      const res = await fetch(`${root}/api-keys/${keyId}`, {
        method: 'DELETE',
        headers: headers(opts),
      })
      return parseResponse(res)
    },

    async patchSettings(body: Record<string, unknown>) {
      const res = await fetch(`${root}/settings`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async getArticle(articleId: string) {
      const res = await fetch(`${root}/articles/${articleId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async patchArticle(
      articleId: string,
      body: {
        status?:
          | 'draft'
          | 'brief_pending'
          | 'generating'
          | 'qa_pending'
          | 'qa_review'
          | 'approved'
          | 'queued'
          | 'delivered'
          | 'published'
          | 'archived'
        tags?: string[]
        scheduled_publish_at?: string | null
        meta_title?: string
        meta_description?: string
        canonical_url?: string | null
        title?: string
        description?: string | null
      }
    ) {
      const res = await fetch(`${root}/articles/${articleId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async getArticleInternalLinks(articleId: string) {
      const res = await fetch(`${root}/articles/${articleId}/links`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async postArticleInternalLinks(articleId: string, body?: { inject?: boolean }) {
      const res = await fetch(`${root}/articles/${articleId}/links`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body ?? {}),
      })
      return parseResponse(res)
    },

    async seedKeywords(keywords: Array<{
      keyword: string
      cluster_name?: string
      search_volume?: number
      difficulty?: number
      intent?: 'informational' | 'navigational' | 'commercial' | 'transactional'
      priority_score?: number
      is_seed?: boolean
    }>) {
      const res = await fetch(`${root}/keywords`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ keywords }),
      })
      return parseResponse(res)
    },

    async schedulePublish(body: {
      article_ids?: string[]
      limit?: number
      first_publish_at?: string
      spacing_minutes?: number
    }) {
      const res = await fetch(`${root}/content/schedule`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async listKeywords(query?: {
      limit?: number
      offset?: number
      status?: string
      cluster?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      if (query?.cluster) sp.set('cluster', query.cluster)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/keywords${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listContentRequests(query?: { limit?: number; offset?: number; status?: string }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/content/requests${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async allocateContentRequest(requestId: string) {
      const res = await fetch(`${root}/content/requests/${requestId}/allocate`, {
        method: 'POST',
        headers: headers(opts),
        body: '{}',
      })
      return parseResponse(res)
    },

    async getContentRequest(requestId: string) {
      const res = await fetch(`${root}/content/requests/${requestId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async patchContentRequest(
      requestId: string,
      body: { status: 'cancelled' } | { notes: string | null }
    ) {
      const res = await fetch(`${root}/content/requests/${requestId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async cancelContentRequest(requestId: string) {
      const res = await fetch(`${root}/content/requests/${requestId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify({ status: 'cancelled' }),
      })
      return parseResponse(res)
    },

    async syncGscKeywords(rows: Array<{
      keyword: string
      clicks?: number
      impressions?: number
      ctr?: number
      position?: number
      search_volume?: number
      difficulty?: number
      cpc_usd?: number
      intent?: 'informational' | 'navigational' | 'commercial' | 'transactional'
      cluster_name?: string
      is_seed?: boolean
    }>) {
      const res = await fetch(`${root}/keywords/gsc-sync`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ rows }),
      })
      return parseResponse(res)
    },

    async listKeywordClusters() {
      const res = await fetch(`${root}/keywords/clusters`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async assignKeywordClusters(
      assignments: Array<{ keyword_id: string; cluster_name: string }>
    ) {
      const res = await fetch(`${root}/keywords/clusters`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify({ assignments }),
      })
      return parseResponse(res)
    },

    async listBriefs(query?: {
      limit?: number
      offset?: number
      status?: string
      /** When true, do not default to `pending`; list all statuses unless `status` is set. */
      all_statuses?: boolean
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      if (query?.all_statuses) sp.set('all_statuses', '1')
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/briefs${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async getBrief(briefId: string) {
      const res = await fetch(`${root}/briefs/${briefId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async patchBrief(
      briefId: string,
      body: {
        status?: 'pending' | 'assigned' | 'generating' | 'complete'
        tone_notes?: string | null
        cta_guidance?: string | null
      }
    ) {
      const res = await fetch(`${root}/briefs/${briefId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async getKeyword(keywordId: string) {
      const res = await fetch(`${root}/keywords/${keywordId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async patchKeyword(
      keywordId: string,
      body: {
        cluster_name?: string | null
        status?: 'unassigned' | 'brief_created' | 'assigned' | 'published'
        priority_score?: number | null
        is_seed?: boolean
        article_id?: string | null
      }
    ) {
      const res = await fetch(`${root}/keywords/${keywordId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async generateFromBrief(
      briefId: string,
      body?: {
        target_word_count?: number
        target_persona?: string
        tone_notes?: string
        cta_guidance?: string
        content_type?: string
        auto_deliver?: boolean
      }
    ) {
      const res = await fetch(`${root}/briefs/${briefId}/generate`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body ?? {}),
      })
      return parseResponse(res)
    },

    async processPendingBriefs(body?: {
      limit?: number
      target_word_count?: number
      target_persona?: string
      tone_notes?: string
      cta_guidance?: string
      content_type?: string
      auto_deliver?: boolean
    }) {
      const res = await fetch(`${root}/briefs/process-pending`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body ?? {}),
      })
      return parseResponse(res)
    },

    async listArticles(query?: { limit?: number; offset?: number; status?: string }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/articles${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listDeliveries(query?: { limit?: number; offset?: number; status?: string }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/deliveries${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listAuditLog(query?: {
      limit?: number
      offset?: number
      action?: string
      entity_type?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.action) sp.set('action', query.action)
      if (query?.entity_type) sp.set('entity_type', query.entity_type)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/audit-log${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listPublishLogs(query?: {
      limit?: number
      offset?: number
      event_type?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.event_type) sp.set('event_type', query.event_type)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/publish-logs${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listRefreshQueue(query?: {
      limit?: number
      offset?: number
      status?: string
      /** When true, omit default `queued` filter and return all statuses. */
      all_statuses?: boolean
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      if (query?.all_statuses) sp.set('all_statuses', '1')
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/refresh${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    /** Enqueue stale articles (`stale_days`) or specific `article_ids` for refresh. */
    async enqueueRefresh(body?: { stale_days?: number; article_ids?: string[] }) {
      const res = await fetch(`${root}/refresh`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body ?? {}),
      })
      return parseResponse(res)
    },

    /** Pop and process the next refresh queue item (highest priority). */
    async processNextRefresh() {
      const res = await fetch(`${root}/refresh/process`, {
        method: 'POST',
        headers: headers(opts),
        body: '{}',
      })
      return parseResponse(res)
    },

    async getDelivery(deliveryId: string) {
      const res = await fetch(`${root}/deliveries/${deliveryId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async retryDelivery(deliveryId: string) {
      const res = await fetch(`${root}/deliveries/${deliveryId}/retry`, {
        method: 'POST',
        headers: headers(opts),
      })
      return parseResponse(res)
    },

    async listGscPerformance(query?: { limit?: number; from?: string; to?: string }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.from) sp.set('from', query.from)
      if (query?.to) sp.set('to', query.to)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/keywords/gsc-performance${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listArticlePerformance(query?: {
      limit?: number
      offset?: number
      article_id?: string
      from?: string
      to?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.article_id) sp.set('article_id', query.article_id)
      if (query?.from) sp.set('from', query.from)
      if (query?.to) sp.set('to', query.to)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/article-performance${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async syncArticlePerformance(
      rows: Array<{
        article_id: string
        date: string
        sessions?: number
        pageviews?: number
        avg_scroll_depth?: number | null
        reads_complete?: number
        cta_clicks?: number
        conversions?: number
        attributed_revenue_usd?: number
        avg_position?: number | null
        impressions?: number
        clicks?: number
        ctr?: number | null
      }>
    ) {
      const res = await fetch(`${root}/article-performance`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ rows }),
      })
      return parseResponse(res)
    },

    async listExperiments(query?: {
      limit?: number
      offset?: number
      article_id?: string
      status?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.article_id) sp.set('article_id', query.article_id)
      if (query?.status) sp.set('status', query.status)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/experiments${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async createExperiment(body: {
      article_id: string
      variant_type:
        | 'title'
        | 'meta_description'
        | 'cta_text'
        | 'cta_position'
        | 'h2_heading'
        | 'intro_paragraph'
      control_value: string
      variant_value: string
    }) {
      const res = await fetch(`${root}/experiments`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async getExperiment(experimentId: string) {
      const res = await fetch(`${root}/experiments/${experimentId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async patchExperiment(
      experimentId: string,
      body: {
        status?: 'running' | 'paused' | 'concluded' | 'cancelled'
        winner?: 'control' | 'variant' | null
        concluded_at?: string | null
        significance_pct?: number | null
        control_conversions?: number
        variant_conversions?: number
        control_sessions?: number
        variant_sessions?: number
      }
    ) {
      const res = await fetch(`${root}/experiments/${experimentId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async listPublishQueue(query?: { limit?: number; offset?: number; status?: string }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/content/publish-queue${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async confirmPublish(body: {
      article_id: string
      slug: string
      published_url?: string
      published_at?: string
      submit_indexnow?: boolean
    }) {
      const res = await fetch(`${root}/content/publish`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async ingestEvents(events: Array<{
      event_name: string
      article_id?: string
      client_event_id?: string
      occurred_at?: string
      payload?: Record<string, unknown>
    }>) {
      const res = await fetch(`${root}/events/ingest`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ events }),
      })
      return parseResponse(res)
    },

    async listEvents(query?: {
      limit?: number
      offset?: number
      article_id?: string
      event_name?: string
      from?: string
      to?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.article_id) sp.set('article_id', query.article_id)
      if (query?.event_name) sp.set('event_name', query.event_name)
      if (query?.from) sp.set('from', query.from)
      if (query?.to) sp.set('to', query.to)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/events${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async getEvent(eventId: string) {
      const res = await fetch(`${root}/events/${eventId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async listGenerationJobs(query?: {
      limit?: number
      offset?: number
      status?: string
      brief_id?: string
      article_id?: string
    }) {
      const sp = new URLSearchParams()
      if (query?.limit != null) sp.set('limit', String(query.limit))
      if (query?.offset != null) sp.set('offset', String(query.offset))
      if (query?.status) sp.set('status', query.status)
      if (query?.brief_id) sp.set('brief_id', query.brief_id)
      if (query?.article_id) sp.set('article_id', query.article_id)
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/generation-jobs${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async getGenerationJob(jobId: string) {
      const res = await fetch(`${root}/generation-jobs/${jobId}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async getGaps() {
      return fetchDashboardGaps()
    },

    async getDashboardSummary() {
      const res = await fetch(`${root}/dashboard/summary`, { headers: headers(opts) })
      return parseResponse(res)
    },

    async generateArticle(body: {
      focus_keyword: string
      secondary_keywords?: string[]
      content_type?: 'pillar' | 'cluster' | 'comparison' | 'alternatives' | 'faq' | 'guide' | 'case_study'
      cluster_name?: string
      target_word_count?: number
      target_persona?: string
      tone_notes?: string
      cta_guidance?: string
      auto_deliver?: boolean
    }) {
      const res = await fetch(`${root}/generate`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async deliverArticle(article_id: string) {
      const res = await fetch(`${root}/content/deliver`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ article_id }),
      })
      return parseResponse(res)
    },

    /** Submit published URLs to IndexNow (key optional if set in app metadata). */
    async submitIndexNow(body: {
      urls: string[]
      key?: string
      key_location?: string
      host?: string
    }) {
      const res = await fetch(`${root}/indexnow`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({
          urls: body.urls,
          key: body.key,
          key_location: body.key_location,
          host: body.host,
        }),
      })
      return parseResponse(res)
    },

    /** Latest QA report, or history with `{ all: true, limit?: number }`. */
    async getArticleQa(
      articleId: string,
      options?: { all?: boolean; limit?: number }
    ) {
      const sp = new URLSearchParams()
      if (options?.all) sp.set('all', '1')
      if (options?.limit != null) sp.set('limit', String(options.limit))
      const q = sp.toString() ? `?${sp}` : ''
      const res = await fetch(`${root}/articles/${articleId}/qa${q}`, { headers: headers(opts) })
      return parseResponse(res)
    },

    /**
     * Article-scoped experiments (includes live `stats` from the control plane).
     * Prefer these when working from a known `articleId`; app-level `/experiments` is for cross-article lists.
     */
    async listExperimentsForArticle(articleId: string) {
      const res = await fetch(`${root}/articles/${articleId}/experiments`, {
        headers: headers(opts),
      })
      return parseResponse(res)
    },

    async createExperimentForArticle(
      articleId: string,
      body: {
        variant_type:
          | 'title'
          | 'meta_description'
          | 'cta_text'
          | 'cta_position'
          | 'h2_heading'
          | 'intro_paragraph'
        control_value: string
        variant_value: string
      }
    ) {
      const res = await fetch(`${root}/articles/${articleId}/experiments`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    async getExperimentForArticle(articleId: string, experimentId: string) {
      const res = await fetch(`${root}/articles/${articleId}/experiments/${experimentId}`, {
        headers: headers(opts),
      })
      return parseResponse(res)
    },

    async patchExperimentForArticle(
      articleId: string,
      experimentId: string,
      body: {
        action?: 'pause' | 'resume' | 'conclude' | 'cancel'
        apply_winner?: boolean
        control_conversions?: number
        variant_conversions?: number
        control_sessions?: number
        variant_sessions?: number
      }
    ) {
      const res = await fetch(`${root}/articles/${articleId}/experiments/${experimentId}`, {
        method: 'PATCH',
        headers: headers(opts),
        body: JSON.stringify(body),
      })
      return parseResponse(res)
    },

    /** Legacy alias for `getGaps()` (same `/dashboard/gaps` payload). */
    async getDashboard() {
      return fetchDashboardGaps()
    },
  }
}

/** Verify an incoming SCP webhook signature on the base app side. */
export async function verifySCPWebhook(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(webhookSecret)
  const msgData = encoder.encode(rawBody)
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, msgData)
  const expected =
    'sha256=' +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  if (expected.length !== signatureHeader.length) return false
  const a = new TextEncoder().encode(expected)
  const b = new TextEncoder().encode(signatureHeader)
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
