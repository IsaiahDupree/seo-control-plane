import { createAdminClient } from '@/lib/supabase'
import { NextRequest } from 'next/server'

export async function verifyApiKey(request: NextRequest): Promise<{ appId: string } | null> {
  const appIdHeader = request.headers.get('X-App-ID')
  if (!appIdHeader) return null
  return verifyApiKeyForApp(request, appIdHeader)
}

/** Path-style routes: app id from URL segment (preferred for /api/v1/apps/[appId]/…). */
export async function verifyApiKeyForApp(
  request: NextRequest,
  appId: string
): Promise<{ appId: string } | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const key = authHeader.slice(7)
  const db = createAdminClient()
  const keyHash = await hashKey(key)

  const { data } = await db
    .from('scp_api_keys')
    .select('app_id, revoked_at')
    .eq('key_hash', keyHash)
    .eq('app_id', appId)
    .maybeSingle()

  if (!data || data.revoked_at) return null

  await db
    .from('scp_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('app_id', appId)
    .eq('key_hash', keyHash)

  return { appId: data.app_id }
}

export async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function generateApiKey(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return 'scp_' + Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateWebhookSecret(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return 'whsec_' + Array.from(array).map((b) => b.toString(16).padStart(2, '0')).join('')
}
