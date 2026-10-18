// F-CP-059: Keyword CSV import
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { requireAppAuth } from '@/lib/require-app-auth'
import { jsonError } from '@/lib/api-errors'

type RouteContext = { params: Promise<{ appId: string }> }

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''))
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) ?? line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').replace(/^"|"$/g, '').trim()
    })
    return row
  })
}

const VALID_INTENTS = new Set(['informational', 'navigational', 'commercial_investigation', 'transactional'])

export async function POST(request: NextRequest, context: RouteContext) {
  const { appId } = await context.params
  const gate = await requireAppAuth(request, appId)
  if ('error' in gate) return gate.error

  const contentType = request.headers.get('content-type') ?? ''
  let rows: Record<string, string>[]

  if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
    const text = await request.text()
    rows = parseCSV(text)
  } else {
    // JSON array of keyword objects
    let json: unknown
    try {
      json = await request.json()
    } catch {
      return jsonError(400, 'invalid_body', 'Send CSV (text/csv) or JSON array')
    }
    if (!Array.isArray(json)) {
      return jsonError(400, 'invalid_body', 'JSON body must be an array of keyword objects')
    }
    rows = json as Record<string, string>[]
  }

  if (rows.length === 0) {
    return jsonError(400, 'empty_import', 'No keyword rows found')
  }
  if (rows.length > 5000) {
    return jsonError(400, 'too_many_rows', 'Maximum 5000 keywords per import')
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const records = rows
    .filter((r) => r.keyword && r.keyword.trim())
    .map((r) => ({
      app_id: appId,
      keyword: r.keyword.trim().toLowerCase(),
      search_volume: r.volume ? parseInt(r.volume, 10) || null : null,
      difficulty: r.difficulty ? parseFloat(r.difficulty) || null : null,
      cpc_usd: r.cpc ? parseFloat(r.cpc) || null : null,
      intent_type: VALID_INTENTS.has(r.intent ?? '') ? r.intent : null,
      cluster_name: r.cluster ?? null,
      is_seed: r.is_seed === 'true' || r.is_seed === '1',
      is_competitor_term: r.is_competitor_term === 'true' || r.is_competitor_term === '1',
      status: 'active',
      source: 'import',
      created_at: now,
      updated_at: now,
    }))

  if (records.length === 0) {
    return jsonError(400, 'no_valid_keywords', 'No rows had a non-empty keyword column')
  }

  // Upsert on (app_id, keyword) — normalised
  const { data, error } = await admin
    .from('scp_keywords')
    .upsert(records, { onConflict: 'app_id,keyword', ignoreDuplicates: false })
    .select('id, keyword, intent_type, search_volume, difficulty')

  if (error) return jsonError(500, 'import_failed', error.message)

  return NextResponse.json({
    imported: data?.length ?? 0,
    total_rows: rows.length,
    skipped: rows.length - records.length,
  })
}
