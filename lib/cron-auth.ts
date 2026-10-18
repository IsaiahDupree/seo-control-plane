import { NextRequest } from 'next/server'

/**
 * Prefer `SCP_CRON_SECRET`; fall back to Vercel-style `CRON_SECRET` so one value
 * can protect every `/api/cron/*` route.
 */
export function getCronSecret(): string | undefined {
  const s =
    process.env.SCP_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim()
  return s || undefined
}

/**
 * When a secret is configured, require `Authorization: Bearer <secret>`.
 * When unset, allows the request (local dev only — set a secret in production).
 */
export function cronBearerOk(request: NextRequest): boolean {
  const secret = getCronSecret()
  if (!secret) return true
  return request.headers.get('Authorization') === `Bearer ${secret}`
}
