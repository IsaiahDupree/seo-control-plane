// F-CP-061: Keyword volume enrichment — bulk update search_volume, difficulty, cpc
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const enrichEntry = z.object({
  keyword: z.string().min(1).max(200),
  search_volume: z.number().int().min(0).optional(),
  difficulty: z.number().min(0).max(100).optional(),
  cpc_usd: z.number().min(0).optional(),
  competition: z.number().min(0).max(1).optional(),
  trend_monthly: z.array(z.number().int().min(0)).max(12).optional(),
})

const enrichBody = z.object({
  entries: z.array(enrichEntry).min(1).max(5000),
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

  const parsed = enrichBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  let updated = 0
  const errors: string[] = []

  for (let i = 0; i < parsed.data.entries.length; i += 200) {
    const batch = parsed.data.entries.slice(i, i + 200)

    for (const entry of batch) {
      const updatePayload: Record<string, unknown> = { updated_at: now }
      if (entry.search_volume !== undefined) updatePayload.search_volume = entry.search_volume
      if (entry.difficulty !== undefined) updatePayload.difficulty = entry.difficulty
      if (entry.cpc_usd !== undefined) updatePayload.cpc_usd = entry.cpc_usd
      if (entry.competition !== undefined) updatePayload.competition = entry.competition
      if (entry.trend_monthly !== undefined) updatePayload.trend_monthly = entry.trend_monthly

      const { error } = await admin
        .from('scp_keywords')
        .update(updatePayload)
        .eq('app_id', appId)
        .eq('keyword', entry.keyword.toLowerCase().trim())

      if (error) {
        errors.push(`${entry.keyword}: ${error.message}`)
      } else {
        updated++
      }
    }
  }

  return NextResponse.json({
    updated,
    total: parsed.data.entries.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  })
}
