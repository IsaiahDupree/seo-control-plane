import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'
import { SignOutButton } from '@/app/components/sign-out-button'
import { ArticleStatusBadge } from '@/app/components/article-status-badge'
import { ArticleTitleStack } from '@/app/components/article-title-stack'
import { KeywordStatusBadge } from '@/app/components/keyword-status-badge'
import { QaScoreInline } from '@/app/components/qa-score-inline'
import { StatusBreakdownChips } from '@/app/components/status-breakdown-chips'
import { fetchArticleStatusBreakdown } from '@/lib/article-status-metrics'
import { fetchKeywordStatusBreakdown } from '@/lib/keyword-status-metrics'

type PageProps = { params: Promise<{ appId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { appId } = await params
  try {
    const db = createAdminClient()
    const { data } = await db.from('scp_apps').select('name').eq('id', appId).maybeSingle()
    if (data?.name) return { title: data.name }
  } catch {
    /* Prerender or missing SUPABASE_SERVICE_ROLE_KEY */
  }
  return { title: 'App' }
}

interface AppDetail {
  id: string
  slug: string
  name: string
  base_url: string | null
  status: string | null
  plan: string | null
  monthly_article_limit: number | null
  monthly_articles_used: number | null
  webhook_url: string | null
  context: Record<string, unknown>
  created_at: string
  updated_at: string
}

export default async function AppDetailPage({ params }: PageProps) {
  const { appId } = await params

  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdminClient()

  const { data: app } = await db
    .from('scp_apps')
    .select('id, slug, name, base_url, status, plan, monthly_article_limit, monthly_articles_used, webhook_url, context, created_at, updated_at')
    .eq('id', appId)
    .single()

  if (!app) notFound()
  const appData = app as AppDetail

  const weekCutoff = new Date()
  weekCutoff.setUTCDate(weekCutoff.getUTCDate() - 7)
  const weekAgo = weekCutoff.toISOString()

  const [
    articleMetrics,
    keywordMetrics,
    { count: articlesThisWeek },
    { count: openRequests },
    { count: pendingBriefs },
    { count: totalDeliveries },
    { count: refreshQueue },
    { count: activeExperiments },
    { data: recentArticles },
    { data: recentKeywords },
    { data: apiKeys },
  ] = await Promise.all([
    fetchArticleStatusBreakdown(db, { appId }),
    fetchKeywordStatusBreakdown(db, { appId }),
    db.from('scp_articles').select('*', { count: 'exact', head: true }).eq('app_id', appId).gte('created_at', weekAgo),
    db.from('scp_content_requests').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'open'),
    db.from('scp_content_briefs').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'pending'),
    db.from('scp_deliveries').select('*', { count: 'exact', head: true }).eq('app_id', appId),
    db.from('scp_refresh_queue').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'pending'),
    db.from('scp_experiments').select('*', { count: 'exact', head: true }).eq('app_id', appId).eq('status', 'running'),
    db
      .from('scp_articles')
      .select('id, slug, title, status, qa_score, word_count, created_at, canonical_url')
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('scp_keywords').select('id, keyword, status, search_volume, intent, is_seed').eq('app_id', appId).order('search_volume', { ascending: false }).limit(12),
    db.from('scp_api_keys').select('id, key_prefix, label, revoked_at, last_used_at, created_at').eq('app_id', appId).is('revoked_at', null).order('created_at', { ascending: false }),
  ])

  const totalArticles = articleMetrics.totalArticles
  const articleStatusBreakdown = articleMetrics.statusBreakdown

  const totalKeywords = keywordMetrics.totalKeywords
  const unassignedKw = keywordMetrics.statusTotals.unassigned
  const keywordStatusBreakdown = keywordMetrics.statusBreakdown

  const usedLimit = appData.monthly_article_limit
  const usedCount = appData.monthly_articles_used ?? 0
  const pct = usedLimit ? Math.min(100, Math.round((usedCount / usedLimit) * 100)) : null

  return (
    <main className="min-h-screen bg-[#0a0a0b]">
      {/* Nav */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Link href="/" className="text-zinc-500 hover:text-zinc-300">SEO Control Plane</Link>
            <span className="text-zinc-700">/</span>
            <span className="font-medium text-zinc-100">{appData.name}</span>
            <code className="ml-2 rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-500">
              {appData.slug}
            </code>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">

        {/* App meta */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-zinc-100">{appData.name}</h1>
              {appData.base_url && (
                <a href={appData.base_url} target="_blank" rel="noopener noreferrer"
                  className="mt-1 text-sm text-emerald-400 hover:underline">
                  {appData.base_url}
                </a>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                <span>ID: <code className="text-zinc-400">{appData.id}</code></span>
                <span>·</span>
                <span>Plan: <span className="text-zinc-300">{appData.plan ?? 'starter'}</span></span>
                <span>·</span>
                <span>Webhook: <span className={appData.webhook_url ? 'text-emerald-400' : 'text-red-400'}>
                  {appData.webhook_url ? 'configured' : 'not set'}
                </span></span>
                <span>·</span>
                <span>Created: <span className="text-zinc-400">{new Date(appData.created_at).toLocaleDateString()}</span></span>
              </div>
            </div>
            <span className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium ${
              appData.status === 'active'
                ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700'
            }`}>
              {appData.status ?? 'active'}
            </span>
          </div>

          {/* Monthly quota bar */}
          {usedLimit && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
                <span>Monthly articles used</span>
                <span className="text-zinc-300">{usedCount} / {usedLimit}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct! >= 90 ? 'bg-red-500' : pct! >= 70 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Stats grid */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Stats</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {[
              { label: 'Articles',     value: totalArticles ?? 0,      color: 'text-zinc-100' },
              { label: 'This week',    value: articlesThisWeek ?? 0,   color: 'text-emerald-400' },
              { label: 'Deliveries',   value: totalDeliveries ?? 0,    color: 'text-blue-400' },
              { label: 'Keywords',     value: totalKeywords ?? 0,      color: 'text-zinc-100' },
              { label: 'Unassigned',   value: unassignedKw ?? 0,       color: 'text-orange-400' },
              { label: 'Open requests',value: openRequests ?? 0,       color: 'text-yellow-400' },
              { label: 'Pending briefs',value: pendingBriefs ?? 0,     color: 'text-purple-400' },
              { label: 'Refresh queue',value: refreshQueue ?? 0,       color: 'text-amber-400' },
              { label: 'Experiments',  value: activeExperiments ?? 0,  color: 'text-pink-400' },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <p className="text-[11px] text-zinc-500 leading-tight">{s.label}</p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
          <StatusBreakdownChips
            title="Articles by status"
            items={articleStatusBreakdown}
            variant="article"
          />
          <StatusBreakdownChips
            title="Keywords by status"
            items={keywordStatusBreakdown}
            variant="keyword"
          />
        </section>

        <div className="grid gap-8 lg:grid-cols-2">

          {/* Recent articles */}
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Recent Articles</h2>
            {(recentArticles ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">
                No articles yet
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80">
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">Title</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-zinc-500 hidden sm:table-cell">QA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {(recentArticles ?? []).map(
                      (a: {
                        id: string
                        title: string
                        slug: string
                        status: string
                        qa_score: number | null
                        word_count: number | null
                        created_at: string
                        canonical_url: string | null
                      }) => (
                      <tr key={a.id} className="hover:bg-zinc-900/40">
                        <td className="px-3 py-2 max-w-[180px]">
                          <ArticleTitleStack
                            title={a.title}
                            slug={a.slug}
                            canonicalUrl={a.canonical_url}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <ArticleStatusBadge status={a.status} />
                        </td>
                        <td className="px-3 py-2 text-right text-xs hidden sm:table-cell">
                          <QaScoreInline score={a.qa_score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Top keywords */}
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Keywords</h2>
            {(recentKeywords ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">
                No keywords seeded yet
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80">
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">Keyword</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500">Status</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-zinc-500 hidden sm:table-cell">Vol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {(recentKeywords ?? []).map((k: { id: string; keyword: string; status: string; search_volume: number | null; intent: string | null; is_seed: boolean }) => (
                      <tr key={k.id} className="hover:bg-zinc-900/40">
                        <td className="px-3 py-2">
                          <span className="text-xs text-zinc-200">{k.keyword}</span>
                          {k.is_seed && (
                            <span className="ml-1.5 rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500">seed</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <KeywordStatusBadge status={k.status} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-zinc-500 hidden sm:table-cell">
                          {k.search_volume?.toLocaleString() ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

        </div>

        {/* API keys */}
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Active API Keys</h2>
          {(apiKeys ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-600">
              No active API keys
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Label</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Prefix</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden sm:table-cell">Last used</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden md:table-cell">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {(apiKeys ?? []).map((k: { id: string; label: string; key_prefix: string; last_used_at: string | null; created_at: string }) => (
                    <tr key={k.id} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-2.5 text-zinc-200 text-sm">{k.label}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{k.key_prefix}…</td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 hidden sm:table-cell">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : <span className="text-zinc-700">never</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-600 hidden md:table-cell">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Quick API reference for this app */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">API Base</h2>
          <code className="text-sm text-emerald-400">
            /api/v1/apps/{appData.id}/
          </code>
          <div className="mt-3 grid gap-1 font-mono text-xs text-zinc-600 sm:grid-cols-2">
            {[
              ['GET',   'dashboard/summary'],
              ['GET',   'dashboard/gaps'],
              ['GET',   'settings'],
              ['PATCH', 'settings'],
              ['GET',   'api-keys'],
              ['GET',   'keywords'],
              ['POST',  'keywords'],
              ['POST',  'keywords/gsc-sync'],
              ['POST',  'content/request'],
              ['GET',   'content/requests'],
              ['GET',   'briefs'],
              ['GET',   'articles'],
              ['POST',  'generate'],
              ['GET',   'deliveries'],
              ['POST',  'content/deliver'],
              ['POST',  'content/publish'],
              ['POST',  'indexnow'],
              ['GET',   'refresh'],
              ['POST',  'refresh'],
              ['POST',  'refresh/process'],
              ['GET',   'audit-log'],
              ['POST',  'events/ingest'],
            ].map(([m, path]) => (
              <div key={`${m}:${path}`} className="flex gap-2">
                <span className={`w-10 shrink-0 font-semibold ${m === 'GET' ? 'text-blue-500' : m === 'PATCH' ? 'text-amber-500' : 'text-emerald-500'}`}>
                  {m}
                </span>
                <span className="text-zinc-500">{path}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  )
}
