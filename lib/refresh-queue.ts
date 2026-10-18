import { createAdminClient } from '@/lib/supabase'

export interface RefreshCandidate {
  article_id: string
  app_id: string
  slug: string
  title: string
  focus_keyword: string | null
  published_at: string | null
  updated_at: string | null
  days_since_publish: number
  decay_signals: string[]
  priority_score: number
}

const STALE_DAYS = 90 // articles older than this are candidates
// Reserved for future decay heuristics (GSC CTR / position deltas):
// const LOW_PERFORMANCE_CTR = 0.02
// const POSITION_DROP_THRESHOLD = 5

/**
 * Scan published articles for an app and enqueue stale ones into scp_refresh_queue.
 * Returns the count of newly enqueued items.
 */
export async function enqueueStaleArticles(
  appId: string,
  staleDays = STALE_DAYS
): Promise<{ enqueued: number; skipped: number }> {
  const db = createAdminClient()
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString()

  // Fetch articles that haven't been updated recently
  const { data: articles, error } = await db
    .from('scp_articles')
    .select('id, slug, title, focus_keyword, published_at, updated_at, qa_score, word_count')
    .eq('app_id', appId)
    .in('status', ['delivered', 'published'])
    .eq('is_stub', false)
    .not('published_at', 'is', null)
    .lt('published_at', cutoff)

  if (error || !articles) return { enqueued: 0, skipped: 0 }

  // Fetch already-queued article IDs to avoid re-queuing
  const { data: existing } = await db
    .from('scp_refresh_queue')
    .select('article_id')
    .eq('app_id', appId)
    .in('status', ['queued', 'generating'])

  const alreadyQueued = new Set((existing ?? []).map((r) => r.article_id as string))

  let enqueued = 0
  let skipped = 0

  for (const art of articles) {
    if (alreadyQueued.has(art.id)) { skipped++; continue }

    const daysSince = Math.floor(
      (Date.now() - new Date(art.published_at as string).getTime()) / 86_400_000
    )

    const decaySignals: string[] = []
    if (daysSince > staleDays) decaySignals.push('stale_content')
    if ((art.qa_score as number | null) != null && (art.qa_score as number) < 60) {
      decaySignals.push('low_qa_score')
    }
    if ((art.word_count as number | null) != null && (art.word_count as number) < 600) {
      decaySignals.push('thin_content')
    }

    if (decaySignals.length === 0) { skipped++; continue }

    // Priority: more signals + more days stale = higher score
    const priority = Math.min(99, decaySignals.length * 20 + Math.floor(daysSince / 30) * 10)

    await db.from('scp_refresh_queue').insert({
      app_id: appId,
      article_id: art.id,
      reason: decaySignals.join(','),
      decay_signals: decaySignals,
      priority_score: priority,
      status: 'queued',
    })

    enqueued++
  }

  return { enqueued, skipped }
}

/**
 * Pop the highest-priority queued item, mark it generating, run re-generation,
 * then re-deliver. Returns null if queue is empty.
 */
export async function processNextRefreshItem(appId: string): Promise<{
  article_id: string
  slug: string
  success: boolean
  error?: string
} | null> {
  const db = createAdminClient()

  const { data: item } = await db
    .from('scp_refresh_queue')
    .select('id, article_id')
    .eq('app_id', appId)
    .eq('status', 'queued')
    .order('priority_score', { ascending: false })
    .limit(1)
    .single()

  if (!item) return null

  // Mark as generating
  await db
    .from('scp_refresh_queue')
    .update({ status: 'generating' })
    .eq('id', item.id)

  // Load article
  const { data: art } = await db
    .from('scp_articles')
    .select('id, slug, focus_keyword, secondary_keywords, content_type, cluster_name, word_count, target_word_count')
    .eq('id', item.article_id)
    .single()

  if (!art) {
    await db.from('scp_refresh_queue').update({ status: 'skipped' }).eq('id', item.id)
    return { article_id: item.article_id, slug: '', success: false, error: 'Article not found' }
  }

  try {
    // Re-run generation pipeline
    const { runArticleGeneration } = await import('@/lib/generation-pipeline')
    const { data: appRow } = await db
      .from('scp_apps')
      .select('name, context, metadata, monthly_article_limit')
      .eq('id', appId)
      .single()

    if (!appRow) throw new Error('App not found')

    await runArticleGeneration(
      appId,
      {
        name: appRow.name as string,
        context: (appRow.context as Record<string, unknown>) ?? {},
        metadata: (appRow.metadata as Record<string, unknown>) ?? {},
        monthly_article_limit: (appRow.monthly_article_limit as number) ?? 30,
      },
      {
        focus_keyword: art.focus_keyword as string,
        secondary_keywords: (art.secondary_keywords as string[]) ?? [],
        content_type: (art.content_type ?? 'cluster') as import('@/lib/generation-pipeline').ContentTypeOption,
        cluster_name: art.cluster_name as string | undefined,
        target_word_count: (art.target_word_count as number) ?? (art.word_count as number) ?? 1500,
        auto_deliver: true,
        brief_id: null,
        content_request_id: null,
      }
    )

    await db
      .from('scp_refresh_queue')
      .update({ status: 'delivered', completed_at: new Date().toISOString() })
      .eq('id', item.id)

    return { article_id: art.id, slug: art.slug as string, success: true }
  } catch (err) {
    await db.from('scp_refresh_queue').update({ status: 'skipped' }).eq('id', item.id)
    return {
      article_id: art.id,
      slug: art.slug as string,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
