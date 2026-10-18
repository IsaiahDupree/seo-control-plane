import { NextRequest, NextResponse } from 'next/server'
import { cronBearerOk } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase'

/**
 * Vercel Cron: runs on the 1st of each month to reset article generation counters.
 * Schedule: 0 0 1 * * (monthly)
 */
export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Reset monthly article count on all active apps
  const { data, error } = await db
    .from('scp_apps')
    .update({
      monthly_articles_generated: 0,
      quota_reset_at: new Date().toISOString(),
    })
    .eq('status', 'active')
    .select('id, slug')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    ran_at: new Date().toISOString(),
    reset_count: data?.length ?? 0,
  })
}
