// F-CP-026: Content calendar / schedule view
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const { searchParams } = request.nextUrl
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1), 10)
  const view = searchParams.get('view') ?? 'month'

  if (isNaN(year) || year < 2020 || year > 2100) return jsonError(400, 'invalid_year', 'Year out of range')
  if (isNaN(month) || month < 1 || month > 12) return jsonError(400, 'invalid_month', 'Month must be 1-12')

  let fromDate: string
  let toDate: string

  if (view === 'upcoming') {
    fromDate = new Date().toISOString()
    toDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  } else if (view === 'week') {
    const now = new Date()
    const dow = now.getDay()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - dow)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    weekEnd.setHours(23, 59, 59, 999)
    fromDate = weekStart.toISOString()
    toDate = weekEnd.toISOString()
  } else {
    fromDate = new Date(year, month - 1, 1).toISOString()
    toDate = new Date(year, month, 0, 23, 59, 59).toISOString()
  }

  const admin = createAdminClient()

  const [scheduledResult, publishedResult] = await Promise.all([
    admin
      .from('scp_publish_queue')
      .select('id, article_id, scheduled_for, status, position')
      .gte('scheduled_for', fromDate)
      .lte('scheduled_for', toDate)
      .order('scheduled_for', { ascending: true })
      .limit(500),
    admin
      .from('scp_articles')
      .select('id, slug, title, status, focus_keyword, published_at, cluster_name')
      .eq('app_id', appId)
      .in('status', ['published', 'indexed', 'ranked'])
      .gte('published_at', fromDate)
      .lte('published_at', toDate)
      .order('published_at', { ascending: true })
      .limit(200),
  ])

  if (scheduledResult.error) return jsonError(500, 'query_failed', scheduledResult.error.message)

  const scheduled = scheduledResult.data ?? []
  const published = publishedResult.data ?? []

  const calendarItems = [
    ...scheduled.map((s) => ({
      id: s.id,
      article_id: s.article_id,
      type: 'scheduled' as const,
      date: s.scheduled_for,
      queue_position: s.position,
      status: s.status,
      title: null,
      slug: null,
      focus_keyword: null,
      cluster_name: null,
    })),
    ...published.map((p) => ({
      id: p.id,
      article_id: p.id,
      type: 'published' as const,
      date: p.published_at,
      queue_position: null,
      status: p.status,
      title: p.title,
      slug: p.slug,
      focus_keyword: p.focus_keyword ?? null,
      cluster_name: (p as Record<string, unknown>).cluster_name as string | null ?? null,
    })),
  ].sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime())

  return NextResponse.json({
    view,
    from: fromDate,
    to: toDate,
    items: calendarItems,
    scheduled_count: scheduled.length,
    published_count: published.length,
  })
}
