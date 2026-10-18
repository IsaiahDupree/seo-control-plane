// F-CP-044: Keyword opportunity scoring — daily cron job
// opportunity_score = (volume × intent_multiplier × (1 − difficulty/100)) / (existing_articles + 1)
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

const INTENT_MULTIPLIER: Record<string, number> = {
  transactional: 3.0,
  commercial_investigation: 2.5,
  informational: 1.0,
  navigational: 0.5,
}

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Fetch all active keywords with their metadata
  const { data: keywords, error: kwErr } = await admin
    .from('scp_keywords')
    .select('id, app_id, keyword, search_volume, difficulty, intent_type')
    .eq('status', 'active')
    .not('search_volume', 'is', null)

  if (kwErr) {
    return NextResponse.json({ error: kwErr.message }, { status: 500 })
  }

  if (!keywords || keywords.length === 0) {
    return NextResponse.json({ scored: 0, message: 'No active keywords with volume data' })
  }

  // Fetch published article count per keyword per app (for denominator)
  const { data: articles } = await admin
    .from('scp_articles')
    .select('app_id, focus_keyword')
    .in('status', ['published', 'indexed', 'ranked'])

  // Build lookup: app_id+keyword → article count
  const articleCount = new Map<string, number>()
  for (const a of articles ?? []) {
    if (!a.focus_keyword) continue
    const key = `${a.app_id}::${a.focus_keyword.toLowerCase().trim()}`
    articleCount.set(key, (articleCount.get(key) ?? 0) + 1)
  }

  // Score each keyword
  const updates = keywords.map((kw) => {
    const volume = kw.search_volume ?? 0
    const difficulty = Math.min(Math.max(kw.difficulty ?? 50, 0), 100)
    const intentMult = INTENT_MULTIPLIER[kw.intent_type ?? 'informational'] ?? 1.0
    const key = `${kw.app_id}::${kw.keyword.toLowerCase().trim()}`
    const existingArticles = articleCount.get(key) ?? 0

    const score = (volume * intentMult * (1 - difficulty / 100)) / (existingArticles + 1)

    return {
      id: kw.id,
      opportunity_score: Math.round(score * 100) / 100,
    }
  })

  // Batch update in chunks of 500
  let scored = 0
  const errors: string[] = []
  for (let i = 0; i < updates.length; i += 500) {
    const batch = updates.slice(i, i + 500)
    for (const u of batch) {
      const { error } = await admin
        .from('scp_keywords')
        .update({ opportunity_score: u.opportunity_score })
        .eq('id', u.id)
      if (error) {
        errors.push(error.message)
      } else {
        scored++
      }
    }
  }

  return NextResponse.json({
    scored,
    total: keywords.length,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  })
}
