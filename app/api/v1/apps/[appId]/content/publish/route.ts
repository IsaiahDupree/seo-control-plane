import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { publishConfirmBody } from '@/lib/schemas'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import {
  parseIndexNowFromMetadata,
  resolveCanonicalArticleUrl,
  resolveIndexNowHost,
  submitUrlsToIndexNow,
} from '@/lib/indexnow'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

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

  const parsed = publishConfirmBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const [{ data: row, error: fetchErr }, { data: appRow, error: appFetchErr }] = await Promise.all([
    admin
      .from('scp_articles')
      .select('id, app_id, slug, meta_json')
      .eq('id', parsed.data.article_id)
      .eq('app_id', appId)
      .maybeSingle(),
    admin.from('scp_apps').select('id, base_url, metadata').eq('id', appId).maybeSingle(),
  ])

  if (fetchErr || !row) {
    return jsonError(404, 'not_found', 'Article not found for this app')
  }
  if (appFetchErr || !appRow) {
    return jsonError(404, 'app_not_found', 'App not found')
  }

  if (row.slug !== parsed.data.slug) {
    return jsonError(400, 'slug_mismatch', 'Slug does not match article record')
  }

  const publishedAt = parsed.data.published_at ?? new Date().toISOString()
  const prevMeta =
    row.meta_json && typeof row.meta_json === 'object' && !Array.isArray(row.meta_json)
      ? (row.meta_json as Record<string, unknown>)
      : {}
  const metaJson = {
    ...prevMeta,
    ...(parsed.data.published_url ? { published_url: parsed.data.published_url } : {}),
  }

  const { data: updated, error: updErr } = await admin
    .from('scp_articles')
    .update({
      status: 'published',
      published_at: publishedAt,
      meta_json: metaJson,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select('id, slug, status, published_at')
    .single()

  if (updErr || !updated) {
    return jsonError(500, 'update_failed', updErr?.message ?? 'Failed to mark published')
  }

  const inCfg = parseIndexNowFromMetadata(appRow.metadata)
  const runIndexNow =
    parsed.data.submit_indexnow === true || inCfg.onPublish

  type IndexNowResult = {
    attempted: boolean
    skipped_reason?: string
    ok?: boolean
    http_status?: number
    url?: string
    error?: string
  }

  let indexnow: IndexNowResult | undefined

  if (runIndexNow) {
    const canonical = resolveCanonicalArticleUrl({
      publishedUrl: parsed.data.published_url,
      baseUrl: appRow.base_url as string | null,
      slug: row.slug,
    })

    if (!canonical) {
      indexnow = { attempted: false, skipped_reason: 'no_canonical_url' }
    } else if (!inCfg.key) {
      indexnow = { attempted: false, skipped_reason: 'indexnow_key_missing' }
    } else {
      const host = resolveIndexNowHost(canonical, inCfg.hostOverride)
      if (!host) {
        indexnow = { attempted: false, skipped_reason: 'host_required', url: canonical }
      } else {
        try {
          const result = await submitUrlsToIndexNow({
            host,
            key: inCfg.key,
            keyLocation: inCfg.keyLocation,
            urlList: [canonical],
          })
          indexnow = {
            attempted: true,
            ok: result.ok,
            http_status: result.httpStatus,
            url: canonical,
            ...(result.ok ? {} : { error: result.responseText.slice(0, 300) }),
          }
        } catch (err) {
          indexnow = {
            attempted: true,
            ok: false,
            url: canonical,
            error: err instanceof Error ? err.message : 'IndexNow request failed',
          }
        }
      }
    }
  }

  const responseData: Record<string, unknown> = {
    slug: row.slug,
    published_url: parsed.data.published_url ?? null,
    ...(indexnow !== undefined ? { indexnow } : {}),
  }
  await admin.from('scp_publish_logs').insert({
    app_id: appId,
    article_id: row.id,
    delivery_id: null,
    event_type: 'published',
    response_data: responseData,
  })

  const audit_warning = await tryInsertUserAudit(admin, {
    app_id: appId,
    action: 'article.published',
    entity_type: 'article',
    entity_id: row.id,
    performed_by: null,
    payload: {
      source: 'api_key',
      slug: row.slug,
      published_url: parsed.data.published_url ?? null,
      published_at: publishedAt,
      ...(indexnow !== undefined ? { indexnow } : {}),
    },
  })

  return NextResponse.json(
    indexnow !== undefined
      ? { article: updated, indexnow, ...(audit_warning ? { audit_warning } : {}) }
      : { article: updated, ...(audit_warning ? { audit_warning } : {}) }
  )
}
