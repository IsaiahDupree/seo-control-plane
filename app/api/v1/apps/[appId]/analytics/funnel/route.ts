// Conversion funnel analytics — view → engagement → CTA → conversion stages
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
  const since = searchParams.get('since') ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const until = searchParams.get('until') ?? new Date().toISOString().slice(0, 10)

  const admin = createAdminClient()

  const { data: events, error } = await admin
    .from('scp_analytics_events')
    .select('event_name, article_id')
    .eq('app_id', appId)
    .gte('occurred_at', `${since}T00:00:00Z`)
    .lte('occurred_at', `${until}T23:59:59Z`)
    .limit(50000)

  if (error) return jsonError(500, 'query_failed', error.message)

  const rows = events ?? []

  const FUNNEL_STAGES = [
    { stage: 'views', events: ['article_viewed', 'page_view'] },
    { stage: 'engaged', events: ['scroll_50', 'scroll_75', 'read_complete', 'time_on_page'] },
    { stage: 'cta_seen', events: ['cta_viewed'] },
    { stage: 'cta_clicked', events: ['cta_clicked', 'cta_click'] },
    { stage: 'converted', events: ['signup', 'trial_started', 'paid', 'install', 'demo_booked', 'conversion'] },
  ]

  const stageCounts = FUNNEL_STAGES.map(({ stage, events: evNames }) => {
    const count = rows.filter((r) => evNames.includes(r.event_name as string)).length
    const uniqueArticles = new Set(rows.filter((r) => evNames.includes(r.event_name as string)).map((r) => r.article_id)).size
    return { stage, event_count: count, unique_articles: uniqueArticles }
  })

  // Calculate drop-off rates
  const funnel = stageCounts.map((stage, i) => {
    const prev = i > 0 ? stageCounts[i - 1].event_count : stage.event_count
    const dropoff_pct = prev > 0 ? Math.round(((prev - stage.event_count) / prev) * 100) : 0
    const conversion_pct = stageCounts[0].event_count > 0
      ? Math.round((stage.event_count / stageCounts[0].event_count) * 100)
      : 0
    return { ...stage, dropoff_from_previous_pct: dropoff_pct, conversion_from_top_pct: conversion_pct }
  })

  return NextResponse.json({
    period: { since, until },
    funnel,
    overall_conversion_rate: stageCounts[0].event_count > 0
      ? `${Math.round((stageCounts[stageCounts.length - 1].event_count / stageCounts[0].event_count) * 10000) / 100}%`
      : '0%',
  })
}
