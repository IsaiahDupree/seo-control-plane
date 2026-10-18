import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'
import { indexNowSubmitBody } from '@/lib/schemas'
import { hostFromUrl, parseIndexNowFromMetadata, submitUrlsToIndexNow } from '@/lib/indexnow'
import { tryInsertUserAudit } from '@/lib/user-audit'

type RouteContext = { params: Promise<{ appId: string }> }

/**
 * Submit canonical URLs to IndexNow after publish. Key can be passed per request or
 * stored on the app as `metadata.indexnow_key` (+ optional `metadata.indexnow_key_location`).
 */
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

  const parsed = indexNowSubmitBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const { data: app, error: appErr } = await admin
    .from('scp_apps')
    .select('id, metadata')
    .eq('id', appId)
    .single()

  if (appErr || !app) {
    return jsonError(404, 'app_not_found', 'App not found')
  }

  const cfg = parseIndexNowFromMetadata(app.metadata)
  const key = parsed.data.key ?? cfg.key
  const keyLocation = parsed.data.key_location ?? cfg.keyLocation

  if (!key) {
    return jsonError(
      400,
      'indexnow_key_required',
      'Provide `key` in the body or set `metadata.indexnow_key` via PATCH /settings'
    )
  }

  const host =
    parsed.data.host ?? hostFromUrl(parsed.data.urls[0]) ?? cfg.hostOverride ?? null

  if (!host) {
    return jsonError(400, 'host_required', 'Could not derive host; pass `host` explicitly')
  }

  try {
    const result = await submitUrlsToIndexNow({
      host,
      key,
      keyLocation,
      urlList: parsed.data.urls,
    })

    if (!result.ok) {
      return jsonError(502, 'indexnow_rejected', `IndexNow HTTP ${result.httpStatus}`, {
        response: result.responseText.slice(0, 500),
      })
    }

    const audit_warning = await tryInsertUserAudit(admin, {
      app_id: appId,
      action: 'indexnow.submitted',
      entity_type: 'app',
      entity_id: appId,
      performed_by: null,
      payload: {
        source: 'api_key',
        url_count: parsed.data.urls.length,
        host,
        http_status: result.httpStatus,
      },
    })

    return NextResponse.json({
      ok: true,
      submitted: parsed.data.urls.length,
      host,
      indexnow_http_status: result.httpStatus,
      ...(audit_warning ? { audit_warning } : {}),
    })
  } catch (err) {
    return jsonError(
      502,
      'indexnow_fetch_failed',
      err instanceof Error ? err.message : 'IndexNow request failed'
    )
  }
}
