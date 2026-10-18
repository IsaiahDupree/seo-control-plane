import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jsonError } from '@/lib/api-errors'
import { getCronSecret } from '@/lib/cron-auth'
import { runProcessPendingBriefsBatch } from '@/lib/process-pending-briefs'

const querySchema = z.object({
  app_id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(3).optional(),
})

const bodySchema = querySchema

function verifyCronSecret(request: NextRequest): NextResponse | null {
  const secret = getCronSecret()
  if (!secret) {
    return jsonError(
      503,
      'cron_disabled',
      'Set SCP_CRON_SECRET (or CRON_SECRET) for /api/cron/process-pending'
    )
  }
  const auth = request.headers.get('Authorization')
  if (auth !== `Bearer ${secret}`) {
    return jsonError(401, 'unauthorized', 'Invalid or missing Authorization Bearer token')
  }
  return null
}

function mapBatchResult(result: Awaited<ReturnType<typeof runProcessPendingBriefsBatch>>) {
  if (result.kind === 'query_failed') {
    return jsonError(500, 'query_failed', result.message)
  }
  if (result.kind === 'app_not_found') {
    return jsonError(404, 'app_not_found', 'App not found')
  }
  if (result.kind === 'monthly_limit') {
    return jsonError(429, 'monthly_limit_exceeded', 'Monthly article limit reached', {
      used: result.used,
      limit: result.limit,
      partial: result.partial,
    })
  }
  if (result.kind === 'empty') {
    return NextResponse.json({ processed: [], message: 'No pending briefs', source: 'cron' })
  }
  return NextResponse.json({
    processed: result.processed,
    failures: result.failures,
    source: 'cron',
  })
}

/**
 * Vercel Cron / external scheduler: same as POST /api/v1/apps/[appId]/briefs/process-pending
 * but uses `SCP_CRON_SECRET` or `CRON_SECRET` instead of per-app API keys.
 *
 * GET  /api/cron/process-pending?app_id=UUID&limit=1
 * POST /api/cron/process-pending  { "app_id": "UUID", "limit": 1 }
 */
export async function GET(request: NextRequest) {
  const authErr = verifyCronSecret(request)
  if (authErr) return authErr

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries())
  const parsed = querySchema.safeParse(sp)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const limit = parsed.data.limit ?? 1
  const result = await runProcessPendingBriefsBatch(parsed.data.app_id, limit, {})
  return mapBatchResult(result)
}

export async function POST(request: NextRequest) {
  const authErr = verifyCronSecret(request)
  if (authErr) return authErr

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const limit = parsed.data.limit ?? 1
  const result = await runProcessPendingBriefsBatch(parsed.data.app_id, limit, {})
  return mapBatchResult(result)
}
