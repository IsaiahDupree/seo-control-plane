import type { Metadata } from 'next'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase'
import { SignOutButton } from '@/app/components/sign-out-button'
import { ArticleStatusBadge } from '@/app/components/article-status-badge'
import { ArticleTitleStack } from '@/app/components/article-title-stack'
import { QaScoreInline } from '@/app/components/qa-score-inline'
import { StatusBreakdownChips } from '@/app/components/status-breakdown-chips'
import {
  type ArticleStatusCount,
  fetchArticleStatusBreakdown,
} from '@/lib/article-status-metrics'
import {
  type KeywordStatusCount,
  fetchKeywordStatusBreakdown,
} from '@/lib/keyword-status-metrics'

export const metadata: Metadata = {
  title: 'Overview',
}

interface AppRow {
  id: string
  slug: string
  name: string
  status: string | null
  created_at: string
}

interface RecentArticle {
  id: string
  app_id: string
  slug: string
  title: string
  status: string
  qa_score: number | null
  word_count: number | null
  created_at: string
  canonical_url: string | null
  /** PostgREST embed; use `[0]` when present (many-to-one). */
  scp_apps: { name: string; slug: string }[] | null
}

interface PipelineSummary {
  totalApps: number
  totalArticles: number
  totalKeywords: number
  articlesThisWeek: number
  delivered: number
  qaApproved: number
  qaReview: number
  generating: number
  statusBreakdown: ArticleStatusCount[]
  keywordBreakdown: KeywordStatusCount[]
  recentArticles: RecentArticle[]
  pendingRequests: number
  totalEvents: number
}

async function getPipelineSummary(): Promise<PipelineSummary> {
  const db = createAdminClient()

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { count: totalApps },
    articleMetrics,
    keywordMetrics,
    { count: articlesThisWeek },
    { count: pendingRequests },
    { count: totalEvents },
    { data: recentArticles },
  ] = await Promise.all([
    db.from('scp_apps').select('*', { count: 'exact', head: true }),
    fetchArticleStatusBreakdown(db),
    fetchKeywordStatusBreakdown(db),
    db.from('scp_articles').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('scp_content_requests').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('scp_analytics_events').select('*', { count: 'exact', head: true }),
    db
      .from('scp_articles')
      .select(
        'id, app_id, slug, title, status, qa_score, word_count, created_at, canonical_url, scp_apps ( name, slug )'
      )
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const { totalArticles, statusTotals, statusBreakdown } = articleMetrics
  const { totalKeywords, statusBreakdown: keywordBreakdown } = keywordMetrics

  return {
    totalApps: totalApps ?? 0,
    totalArticles,
    totalKeywords,
    articlesThisWeek: articlesThisWeek ?? 0,
    delivered: statusTotals.delivered,
    qaApproved: statusTotals.approved,
    qaReview: statusTotals.qa_review,
    generating: statusTotals.generating,
    statusBreakdown,
    keywordBreakdown,
    recentArticles: (recentArticles ?? []) as RecentArticle[],
    pendingRequests: pendingRequests ?? 0,
    totalEvents: totalEvents ?? 0,
  }
}

export default async function HomePage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <p className="text-xs uppercase tracking-widest text-zinc-500">Authority OS</p>
        <h1 className="mt-3 text-3xl font-semibold">SEO Control Plane</h1>
        <p className="mt-2 text-zinc-400">Centralized content engine for your Vercel blog mesh.</p>
        <Link
          href="/login"
          className="mt-8 inline-flex items-center justify-center rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Sign in →
        </Link>
      </main>
    )
  }

  const db = createAdminClient()
  const [summary, { data: apps }] = await Promise.all([
    getPipelineSummary().catch(() => null),
    db.from('scp_apps').select('id, slug, name, status, created_at').order('created_at', { ascending: false }).limit(20),
  ])

  const appList: AppRow[] = (apps ?? []) as AppRow[]

  return (
    <main className="min-h-screen bg-[#0a0a0b]">
      {/* Top nav */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-widest text-zinc-500">Authority OS</span>
            <span className="text-zinc-700">/</span>
            <span className="font-medium text-zinc-100">SEO Control Plane</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-zinc-500">{user.email}</span>
            <Link
              href="/api/health"
              target="_blank"
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              /health
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">

        {/* Pipeline stats */}
        {summary && (
          <section>
            <h2 className="mb-4 text-sm font-medium text-zinc-400 uppercase tracking-wider">Pipeline</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {[
                { label: 'Apps', value: summary.totalApps, color: 'text-zinc-100' },
                { label: 'Total articles', value: summary.totalArticles, color: 'text-zinc-100' },
                { label: 'Keywords', value: summary.totalKeywords, color: 'text-cyan-400' },
                { label: 'This week', value: summary.articlesThisWeek, color: 'text-emerald-400' },
                { label: 'Generating', value: summary.generating, color: 'text-purple-400' },
                { label: 'QA review', value: summary.qaReview, color: 'text-yellow-400' },
                { label: 'Approved', value: summary.qaApproved, color: 'text-blue-400' },
                { label: 'Delivered', value: summary.delivered, color: 'text-emerald-400' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
                  <p className="text-xs text-zinc-500">{s.label}</p>
                  <p className={`mt-1 text-2xl font-semibold tabular-nums ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Open content requests', value: summary.pendingRequests, color: 'text-orange-400' },
                { label: 'Analytics events', value: summary.totalEvents.toLocaleString(), color: 'text-zinc-300' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 flex items-center justify-between">
                  <p className="text-xs text-zinc-500">{s.label}</p>
                  <p className={`text-lg font-semibold tabular-nums ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <StatusBreakdownChips
              title="Articles by status"
              items={summary.statusBreakdown}
              variant="article"
            />
            <StatusBreakdownChips
              title="Keywords by status"
              items={summary.keywordBreakdown}
              variant="keyword"
            />
          </section>
        )}

        {/* Recent articles */}
        {summary && summary.recentArticles.length > 0 && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Recent Articles</h2>
              <span className="text-xs text-zinc-600">Latest 8</span>
            </div>
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Title</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden md:table-cell">App</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden sm:table-cell">Slug</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500 hidden md:table-cell">QA</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500 hidden md:table-cell">Words</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {summary.recentArticles.map((a) => {
                    const appRow = a.scp_apps?.[0]
                    return (
                    <tr key={a.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-2.5 max-w-[200px] sm:max-w-[220px]">
                        <ArticleTitleStack
                          title={a.title}
                          canonicalUrl={a.canonical_url}
                          titleHref={`/apps/${a.app_id}`}
                        />
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell max-w-[140px]">
                        <Link
                          href={`/apps/${a.app_id}`}
                          className="block truncate text-xs text-zinc-500 hover:text-emerald-400/90 transition-colors"
                        >
                          {appRow?.name ?? appRow?.slug ?? `${a.app_id.slice(0, 8)}…`}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-zinc-500 font-mono text-xs hidden sm:table-cell max-w-[160px] truncate">{a.slug}</td>
                      <td className="px-4 py-2.5">
                        <ArticleStatusBadge status={a.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell">
                        <QaScoreInline score={a.qa_score} />
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-500 tabular-nums hidden md:table-cell">
                        {a.word_count?.toLocaleString() ?? '—'}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Registered apps */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Registered Apps</h2>
            <code className="text-xs text-zinc-600">POST /api/apps/register</code>
          </div>
          {appList.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-700 p-8 text-center">
              <p className="text-zinc-500 text-sm">No apps registered yet.</p>
              <p className="mt-2 text-xs text-zinc-600">
                Use <code className="text-zinc-500">POST /api/apps/register</code> with your{' '}
                <code className="text-zinc-500">SCP_REGISTER_SECRET</code>.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Name</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">Slug</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 hidden sm:table-cell">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500 hidden md:table-cell">ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {appList.map((a) => (
                    <tr key={a.id} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-zinc-100">
                        <Link href={`/apps/${a.id}`} className="hover:text-emerald-400 transition-colors">{a.name}</Link>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">{a.slug}</td>
                      <td className="px-4 py-2.5 hidden sm:table-cell">
                        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${
                          a.status === 'active'
                            ? 'bg-emerald-900/40 text-emerald-400 border-emerald-800'
                            : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                        }`}>
                          {a.status ?? 'active'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-zinc-600 hidden md:table-cell">
                        {a.id.slice(0, 8)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* API reference quick card */}
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">API Endpoints</h2>
          <p className="mb-3 text-xs text-zinc-600 leading-relaxed">
            Errors return JSON <code className="text-zinc-500">{`{ error: { code, message } }`}</code> with a non-2xx status.
            The <code className="text-zinc-500">@authority-os/seo-control-plane-adapter</code> client throws{' '}
            <code className="text-zinc-500">SeoControlPlaneHttpError</code> (<code className="text-zinc-500">status</code>,{' '}
            <code className="text-zinc-500">code</code>, <code className="text-zinc-500">body</code>); narrow with{' '}
            <code className="text-zinc-500">isSeoControlPlaneHttpError</code>.
          </p>
          <div className="grid gap-1 font-mono text-xs text-zinc-500 sm:grid-cols-2">
            {[
              ['GET', '/api/health'],
              ['POST', '/api/apps/register (→ audit app.registered; optional audit_warning)'],
              ['GET',  '/api/v1/apps/[id]/settings'],
              ['PATCH', '/api/v1/apps/[id]/settings'],
              ['GET',  '/api/v1/apps/[id]/api-keys'],
              ['POST', '/api/v1/apps/[id]/api-keys'],
              ['DELETE','/api/v1/apps/[id]/api-keys/[keyId]'],
              ['GET',  '/api/v1/apps/[id]/keywords (?offset=&status=&cluster=)'],
              ['POST', '/api/v1/apps/[id]/keywords'],
              ['GET',  '/api/v1/apps/[id]/keywords/[kid]'],
              ['PATCH','/api/v1/apps/[id]/keywords/[kid]'],
              ['POST', '/api/v1/apps/[id]/keywords/gsc-sync'],
              ['GET',  '/api/v1/apps/[id]/keywords/clusters'],
              ['PATCH','/api/v1/apps/[id]/keywords/clusters'],
              ['POST', '/api/v1/apps/[id]/generate (optional audit_warning)'],
              ['POST', '/api/v1/apps/[id]/content/request'],
              ['GET',  '/api/v1/apps/[id]/content/requests (?offset=&status=)'],
              ['GET',  '/api/v1/apps/[id]/content/requests/[rid]'],
              ['PATCH','/api/v1/apps/[id]/content/requests/[rid] (cancel | notes, open only)'],
              ['POST', '/api/v1/apps/[id]/content/requests/[rid]/allocate'],
              ['GET',  '/api/v1/apps/[id]/content/queue (?full=1&offset=)'],
              ['GET',  '/api/v1/apps/[id]/briefs (?offset=&status=&all_statuses=1)'],
              ['GET',  '/api/v1/apps/[id]/briefs/[bid]'],
              ['PATCH','/api/v1/apps/[id]/briefs/[bid]'],
              ['POST', '/api/v1/apps/[id]/briefs/[bid]/generate (optional audit_warning)'],
              ['POST', '/api/v1/apps/[id]/briefs/process-pending (optional audit_warning)'],
              ['GET',  '/api/v1/apps/[id]/articles (?slug=&focus_keyword=)'],
              ['GET',  '/api/v1/apps/[id]/deliveries'],
              ['GET',  '/api/v1/apps/[id]/deliveries/[did]'],
              ['POST', '/api/v1/apps/[id]/deliveries/[did]/retry'],
              ['GET',  '/api/v1/apps/[id]/publish-logs (?event_type=)'],
              ['GET',  '/api/v1/apps/[id]/refresh (?status=&offset=&all_statuses=1)'],
              ['POST', '/api/v1/apps/[id]/refresh (stale_days | article_ids; optional audit_warning)'],
              ['POST', '/api/v1/apps/[id]/refresh/process (optional audit_warning)'],
              ['GET',  '/api/v1/apps/[id]/keywords/gsc-performance'],
              ['GET',  '/api/cron/process-pending (?app_id=)'],
              ['POST', '/api/cron/process-pending'],
              ['GET',  '/api/cron/refresh'],
              ['GET',  '/api/cron/monthly-reset'],
              ['GET',  '/api/cron/gsc-pull'],
              ['POST', '/api/v1/apps/[id]/content/schedule'],
              ['GET',  '/api/v1/apps/[id]/content/publish-queue (?status=)'],
              ['GET',  '/api/v1/apps/[id]/articles/[articleId]'],
              ['PATCH','/api/v1/apps/[id]/articles/[articleId]'],
              ['GET',  '/api/v1/apps/[id]/audit-log (?action=&entity_type=)'],
              ['GET',  '/api/v1/apps/[id]/articles/[articleId]/links'],
              ['POST', '/api/v1/apps/[id]/articles/[articleId]/links'],
              ['GET',  '/api/v1/apps/[id]/articles/[articleId]/qa (?all=1)'],
              ['GET',  '/api/v1/apps/[id]/articles/[articleId]/experiments'],
              ['POST', '/api/v1/apps/[id]/articles/[articleId]/experiments'],
              ['GET',  '/api/v1/apps/[id]/articles/[articleId]/experiments/[eid]'],
              ['PATCH','/api/v1/apps/[id]/articles/[articleId]/experiments/[eid]'],
              ['POST', '/api/v1/apps/[id]/indexnow'],
              ['POST', '/api/v1/apps/[id]/content/deliver'],
              ['POST', '/api/v1/apps/[id]/content/publish'],
              ['GET',  '/api/v1/apps/[id]/events (?article_id=&event_name=&from=&to=)'],
              ['GET',  '/api/v1/apps/[id]/events/[eventId]'],
              ['POST', '/api/v1/apps/[id]/events/ingest'],
              ['GET',  '/api/v1/apps/[id]/generation-jobs (?status=&brief_id=&article_id=)'],
              ['GET',  '/api/v1/apps/[id]/generation-jobs/[jid]'],
              ['GET',  '/api/v1/apps/[id]/article-performance (?article_id=&from=&to=)'],
              ['POST', '/api/v1/apps/[id]/article-performance'],
              ['GET',  '/api/v1/apps/[id]/experiments (?article_id=&status=)'],
              ['POST', '/api/v1/apps/[id]/experiments'],
              ['GET',  '/api/v1/apps/[id]/experiments/[eid]'],
              ['PATCH','/api/v1/apps/[id]/experiments/[eid]'],
              ['GET',  '/api/v1/apps/[id]/dashboard/gaps'],
              ['GET',  '/api/v1/apps/[id]/dashboard/summary'],
            ].map(([method, path]) => (
              <div key={`${method}:${path}`} className="flex gap-2">
                <span
                  className={`w-12 shrink-0 font-semibold ${
                    method === 'GET' ? 'text-blue-500' : method === 'PATCH' ? 'text-amber-500' : 'text-emerald-500'
                  }`}
                >
                  {method}
                </span>
                <span>{path}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </main>
  )
}
