// F-CP-020: App clone — copies context, keywords, and settings to a new app
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const cloneBody = z.object({
  new_name: z.string().min(1).max(100),
  clone_keywords: z.boolean().default(true),
  clone_context: z.boolean().default(true),
  clone_competitors: z.boolean().default(false),
})

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = cloneBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()

  // Fetch source app
  const { data: sourceApp, error: fetchErr } = await admin
    .from('scp_apps')
    .select('*')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !sourceApp) return jsonError(404, 'not_found', 'Source app not found')

  const now = new Date().toISOString()

  // Create new app row (strip id, created_at, api keys, etc.)
  const { data: newApp, error: createErr } = await admin
    .from('scp_apps')
    .insert({
      name: parsed.data.new_name,
      status: 'active',
      plan: sourceApp.plan,
      monthly_article_limit: sourceApp.monthly_article_limit,
      monthly_articles_generated: 0,
      context: parsed.data.clone_context ? sourceApp.context : {},
      webhook_url: null,
      webhook_secret: null,
      base_url: null,
      domain: null,
      domain_verified: false,
      created_at: now,
      updated_at: now,
    })
    .select('id, name, status, plan')
    .single()

  if (createErr || !newApp) return jsonError(500, 'create_failed', createErr?.message ?? 'Failed to create app')

  const newAppId = newApp.id
  const clonedCounts: Record<string, number> = {}

  // Clone keywords
  if (parsed.data.clone_keywords) {
    const { data: keywords } = await admin
      .from('scp_keywords')
      .select('keyword, search_volume, difficulty, intent_type, cluster_name, source, status, is_seed, is_brand_term, is_competitor_term')
      .eq('app_id', appId)
      .eq('status', 'active')
      .limit(5000)

    if (keywords?.length) {
      const kwRows = keywords.map((k) => ({
        ...k,
        app_id: newAppId,
        opportunity_score: null,
        created_at: now,
        updated_at: now,
      }))
      const { data: inserted } = await admin
        .from('scp_keywords')
        .upsert(kwRows, { onConflict: 'app_id,keyword', ignoreDuplicates: true })
        .select('id')
      clonedCounts.keywords = inserted?.length ?? kwRows.length
    } else {
      clonedCounts.keywords = 0
    }
  }

  // Clone competitors
  if (parsed.data.clone_competitors) {
    const { data: competitors } = await admin
      .from('scp_competitors')
      .select('domain, display_name, why_competitor')
      .eq('app_id', appId)
      .eq('is_active', true)

    if (competitors?.length) {
      const compRows = competitors.map((c) => ({
        ...c,
        app_id: newAppId,
        is_active: true,
        updated_at: now,
      }))
      const { data: inserted } = await admin
        .from('scp_competitors')
        .upsert(compRows, { onConflict: 'app_id,domain', ignoreDuplicates: true })
        .select('id')
      clonedCounts.competitors = inserted?.length ?? compRows.length
    } else {
      clonedCounts.competitors = 0
    }
  }

  return NextResponse.json({
    cloned: true,
    source_app_id: appId,
    new_app: newApp,
    cloned_counts: clonedCounts,
    note: 'Generate a new API key for the cloned app via POST /api/v1/apps/:id/api-keys',
  }, { status: 201 })
}
