// F-CP-053: Keyword merge / deduplicate
// Merges duplicate or near-duplicate keyword entries, keeping the canonical one.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

const mergeBody = z.object({
  canonical_keyword: z.string().min(1).max(200),
  duplicate_keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
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

  const parsed = mergeBody.safeParse(json)
  if (!parsed.success) {
    return jsonError(400, 'validation_error', parsed.error.message)
  }

  const canonical = parsed.data.canonical_keyword.toLowerCase().trim()
  const duplicates = parsed.data.duplicate_keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k !== canonical)

  if (duplicates.length === 0) {
    return jsonError(400, 'no_duplicates', 'No distinct duplicate keywords after normalisation')
  }

  const admin = createAdminClient()

  // Ensure canonical keyword exists
  const { data: canonicalRow, error: canonErr } = await admin
    .from('scp_keywords')
    .select('id, keyword, search_volume, difficulty, opportunity_score, cluster_name')
    .eq('app_id', appId)
    .eq('keyword', canonical)
    .maybeSingle()

  if (canonErr) return jsonError(500, 'query_failed', canonErr.message)
  if (!canonicalRow) return jsonError(404, 'canonical_not_found', `Canonical keyword "${canonical}" not found in this app`)

  // Fetch duplicates
  const { data: dupRows } = await admin
    .from('scp_keywords')
    .select('id, keyword, search_volume, difficulty, opportunity_score')
    .eq('app_id', appId)
    .in('keyword', duplicates)

  const foundDups = dupRows ?? []

  // Merge best metadata into canonical (take max volume, min difficulty)
  const allRows = [canonicalRow, ...foundDups]
  const bestVolume = Math.max(...allRows.map((r) => r.search_volume ?? 0))
  const bestDifficulty = Math.min(...allRows.map((r) => r.difficulty ?? 100))
  const bestOpportunity = Math.max(...allRows.map((r) => r.opportunity_score ?? 0))

  const now = new Date().toISOString()

  const { error: updateErr } = await admin
    .from('scp_keywords')
    .update({
      search_volume: bestVolume > 0 ? bestVolume : null,
      difficulty: bestDifficulty < 100 ? bestDifficulty : null,
      opportunity_score: bestOpportunity > 0 ? bestOpportunity : null,
      updated_at: now,
    })
    .eq('id', canonicalRow.id)

  if (updateErr) return jsonError(500, 'update_failed', updateErr.message)

  // Archive duplicates
  const dupIds = foundDups.map((r) => r.id)
  if (dupIds.length > 0) {
    await admin
      .from('scp_keywords')
      .update({ status: 'archived', updated_at: now })
      .eq('app_id', appId)
      .in('id', dupIds)
  }

  return NextResponse.json({
    canonical_keyword: canonical,
    merged_count: dupIds.length,
    not_found: duplicates.filter((k) => !foundDups.some((r) => r.keyword === k)),
    canonical_id: canonicalRow.id,
    merged_metadata: {
      search_volume: bestVolume > 0 ? bestVolume : null,
      difficulty: bestDifficulty < 100 ? bestDifficulty : null,
      opportunity_score: bestOpportunity > 0 ? bestOpportunity : null,
    },
  })
}
