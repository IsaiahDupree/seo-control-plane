// F-CP-011: App domain verification
// Checks that the app's configured base_url/domain is reachable and returns the expected verification token.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error } = await admin
    .from('scp_apps')
    .select('id, base_url, domain, domain_verified, domain_verification_token')
    .eq('id', appId)
    .maybeSingle()

  if (error) return jsonError(500, 'query_failed', error.message)
  if (!app) return jsonError(404, 'not_found', 'App not found')

  const baseUrl = ((app.base_url ?? (app.domain ? `https://${app.domain}` : null)) as string | null)
  if (!baseUrl) return jsonError(400, 'no_domain', 'App has no base_url or domain configured')

  // Ensure a verification token exists
  let token = app.domain_verification_token as string | null
  if (!token) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    token = 'scp_verify_' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    await admin
      .from('scp_apps')
      .update({ domain_verification_token: token, updated_at: new Date().toISOString() })
      .eq('id', appId)
  }

  return NextResponse.json({
    domain: baseUrl,
    verification_token: token,
    already_verified: !!(app.domain_verified),
    instructions: {
      method_1_meta_tag: `Add <meta name="scp-site-verification" content="${token}"> to your homepage <head>`,
      method_2_txt_record: `Add DNS TXT record: scp-site-verification=${token}`,
      method_3_file: `Host ${baseUrl}/.well-known/scp-verification.txt with content: ${token}`,
    },
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const admin = createAdminClient()
  const { data: app, error: fetchErr } = await admin
    .from('scp_apps')
    .select('id, base_url, domain, domain_verification_token')
    .eq('id', appId)
    .maybeSingle()

  if (fetchErr || !app) return jsonError(404, 'not_found', 'App not found')

  const baseUrl = ((app.base_url ?? (app.domain ? `https://${app.domain}` : null)) as string | null)
  if (!baseUrl) return jsonError(400, 'no_domain', 'App has no base_url or domain configured')

  const token = app.domain_verification_token as string | null
  if (!token) return jsonError(400, 'no_token', 'Call GET first to generate a verification token')

  // Attempt verification via /.well-known/scp-verification.txt
  let verified = false
  let method: string | null = null
  let error: string | null = null

  try {
    const verifyUrl = `${baseUrl.replace(/\/$/, '')}/.well-known/scp-verification.txt`
    const res = await fetch(verifyUrl, { signal: AbortSignal.timeout(8000) })
    if (res.ok) {
      const body = (await res.text()).trim()
      if (body === token) {
        verified = true
        method = 'well_known_file'
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Request failed'
  }

  if (verified) {
    const now = new Date().toISOString()
    await admin
      .from('scp_apps')
      .update({ domain_verified: true, domain_verified_at: now, updated_at: now })
      .eq('id', appId)
  }

  return NextResponse.json({
    verified,
    domain: baseUrl,
    method,
    error: verified ? null : (error ?? 'Token not found at /.well-known/scp-verification.txt'),
    next_steps: verified ? null : [
      'Ensure the verification file is publicly accessible',
      'Check that the file contains only the token with no extra whitespace',
    ],
  })
}
