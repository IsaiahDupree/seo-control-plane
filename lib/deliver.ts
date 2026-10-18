import { createAdminClient } from '@/lib/supabase'
import { signPayload } from '@/lib/hmac'
import { applyInternalLinks } from '@/lib/internal-links'

export interface DeliveryPayload {
  delivery_id: string
  app_id: string
  article_id: string
  version: number
  slug: string
  title: string
  content_html: string
  content_markdown: string
  meta_title: string
  meta_description: string
  og_image_url: string | null
  canonical_url: string
  focus_keyword: string
  secondary_keywords: string[]
  content_type: string
  cluster_name: string | null
  word_count: number
  reading_time_minutes: number
  author: Record<string, unknown>
  schema_json: Record<string, unknown>
  table_of_contents: unknown[]
  cta_blocks: unknown[]
  internal_links: unknown[]
  tags: string[]
  is_stub: boolean
  is_visible: boolean
  published_at: string | null
  quality_score: number | null
  confidence_score: number | null
}

const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [0, 30_000, 120_000]

export async function deliverArticle(
  articleId: string,
  appId: string
): Promise<{ success: boolean; deliveryId: string; error?: string }> {
  const db = createAdminClient()

  // Load article + app
  const [{ data: article }, { data: app }] = await Promise.all([
    db
      .from('scp_articles')
      .select('*')
      .eq('id', articleId)
      .eq('app_id', appId)
      .single(),
    db
      .from('scp_apps')
      .select('id, webhook_url, webhook_secret, slug')
      .eq('id', appId)
      .single(),
  ])

  if (!article) return { success: false, deliveryId: '', error: 'Article not found' }
  if (!app) return { success: false, deliveryId: '', error: 'App not found' }
  if (!app.webhook_url) return { success: false, deliveryId: '', error: 'App has no webhook_url configured' }

  // Create delivery record
  const { data: delivery, error: delivErr } = await db
    .from('scp_deliveries')
    .insert({
      app_id: appId,
      article_id: articleId,
      version: (article.delivery_version ?? 0) + 1,
      status: 'pending',
      delivery_type: 'article',
    })
    .select('id')
    .single()

  if (delivErr || !delivery) {
    return { success: false, deliveryId: '', error: delivErr?.message ?? 'Failed to create delivery' }
  }

  // Inject internal links into HTML before delivery
  const rawHtml: string = article.content_html ?? ''
  const contentText = rawHtml.replace(/<[^>]+>/g, ' ')
  const { html: enrichedHtml, links: injectedLinks } = await applyInternalLinks(
    appId, articleId, rawHtml, contentText
  ).catch(() => ({ html: rawHtml, links: [] }))

  const payload: DeliveryPayload = {
    delivery_id: delivery.id,
    app_id: appId,
    article_id: articleId,
    version: (article.delivery_version ?? 0) + 1,
    slug: article.slug,
    title: article.title,
    content_html: enrichedHtml,
    content_markdown: article.body_mdx ?? article.content_markdown ?? '',
    meta_title: article.meta_title ?? article.title,
    meta_description: article.meta_description ?? article.description ?? '',
    og_image_url: article.og_image_url ?? null,
    canonical_url: article.canonical_url ?? '',
    focus_keyword: article.focus_keyword ?? '',
    secondary_keywords: article.secondary_keywords ?? [],
    content_type: article.content_type ?? 'article',
    cluster_name: article.cluster_name ?? null,
    word_count: article.word_count ?? 0,
    reading_time_minutes: article.reading_time_minutes ?? 1,
    author: article.author ?? {},
    schema_json: article.schema_json ?? {},
    table_of_contents: article.table_of_contents ?? [],
    cta_blocks: article.cta_blocks ?? [],
    internal_links: injectedLinks.length > 0 ? injectedLinks : (article.internal_links ?? []),
    tags: article.tags ?? [],
    is_stub: article.is_stub ?? false,
    is_visible: article.is_visible ?? true,
    published_at: article.published_at ?? null,
    quality_score: article.qa_score ?? null,
    confidence_score: article.confidence_score ?? null,
  }

  const payloadStr = JSON.stringify(payload)
  const signature = await signPayload(payloadStr, app.webhook_secret ?? '')

  // Attempt delivery with retries
  let lastError = ''
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt] ?? 120_000)
    }

    await db
      .from('scp_deliveries')
      .update({ attempts: attempt + 1, last_attempt_at: new Date().toISOString() })
      .eq('id', delivery.id)

    try {
      const res = await fetch(app.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SCP-Signature': signature,
          'X-SCP-Delivery-ID': delivery.id,
          'X-SCP-App-ID': appId,
        },
        body: payloadStr,
        signal: AbortSignal.timeout(30_000),
      })

      if (res.ok) {
        // Mark delivery confirmed
        await db
          .from('scp_deliveries')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            payload_size_bytes: payloadStr.length,
          })
          .eq('id', delivery.id)

        // Update article delivery version + status
        await db
          .from('scp_articles')
          .update({
            delivery_version: payload.version,
            status: 'delivered',
            updated_at: new Date().toISOString(),
          })
          .eq('id', articleId)

        // Log publish event
        await db.from('scp_publish_logs').insert({
          app_id: appId,
          article_id: articleId,
          delivery_id: delivery.id,
          event_type: 'delivered',
          response_data: { status: res.status },
        })

        return { success: true, deliveryId: delivery.id }
      }

      lastError = `HTTP ${res.status}: ${await res.text().catch(() => 'no body')}`
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  // All attempts failed
  await db
    .from('scp_deliveries')
    .update({ status: 'failed', error_message: lastError })
    .eq('id', delivery.id)

  return { success: false, deliveryId: delivery.id, error: lastError }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
