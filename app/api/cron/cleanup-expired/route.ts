// Cron: cleanup expired generation jobs, stale pending queue items, and orphaned briefs
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { cronBearerOk } from '@/lib/cron-auth'

export async function GET(request: NextRequest) {
  if (!cronBearerOk(request)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Invalid cron secret' } }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Archive stale generation jobs stuck in 'pending' or 'processing'
  const { data: staleJobs } = await admin
    .from('scp_generation_jobs')
    .update({ status: 'failed', error_message: 'timed_out_by_cleanup', updated_at: now })
    .in('status', ['pending', 'processing'])
    .lt('created_at', staleCutoff)
    .select('id')

  // Clean up expired refresh queue items (skipped or errored > 14 days)
  const refreshCutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: staleRefresh } = await admin
    .from('scp_refresh_queue')
    .delete()
    .in('status', ['skipped', 'delivered'])
    .lt('queued_at', refreshCutoff)
    .select('id')

  // Expire pending publish queue items past their scheduled_for by > 48h
  const publishCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
  const { data: expiredQueue } = await admin
    .from('scp_publish_queue')
    .update({ status: 'expired', updated_at: now })
    .eq('status', 'pending')
    .lt('scheduled_for', publishCutoff)
    .select('id')

  return NextResponse.json({
    run_at: now,
    stale_jobs_failed: staleJobs?.length ?? 0,
    stale_refresh_deleted: staleRefresh?.length ?? 0,
    expired_queue_items: expiredQueue?.length ?? 0,
  })
}
