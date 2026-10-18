import { NextRequest } from 'next/server'
import { verifyApiKeyForApp } from '@/lib/api-key'
import { jsonError } from '@/lib/api-errors'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export async function requireAppAuth(request: NextRequest, appId: string) {
  if (SKIP_AUTH) {
    return { auth: { appId, keyId: 'dev-local-key' } }
  }

  const auth = await verifyApiKeyForApp(request, appId)
  if (!auth) {
    return { error: jsonError(401, 'unauthorized', 'Invalid or missing API key for this app') }
  }
  return { auth }
}
