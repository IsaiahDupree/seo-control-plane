import { NextResponse } from 'next/server'
import { getCronSecret } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase'

export async function GET() {
  const db = createAdminClient()
  const checks: Record<string, { ok: boolean; count?: number; error?: string }> = {}

  const tables = [
    'scp_apps',
    'scp_api_keys',
    'scp_articles',
    'scp_content_requests',
    'scp_analytics_events',
    'scp_keywords',
    'scp_content_briefs',
    'scp_qa_reports',
    'scp_deliveries',
    'scp_generation_jobs',
    'scp_gsc_performance',
    'scp_refresh_queue',
    'scp_internal_link_edges',
    'scp_publish_logs',
    'scp_article_performance',
    'scp_experiments',
    'scp_publish_queue',
    'scp_user_audit_log',
  ]

  for (const table of tables) {
    try {
      const { count, error } = await db
        .from(table)
        .select('*', { count: 'exact', head: true })
      if (error) {
        const isMissing = error.message.includes('does not exist') ||
          error.message.includes('schema cache') ||
          error.code === '42P01'
        checks[table] = {
          ok: false,
          count: 0,
          error: isMissing ? 'table does not exist — run migrations' : error.message,
        }
      } else {
        checks[table] = { ok: true, count: count ?? 0 }
      }
    } catch (e) {
      checks[table] = { ok: false, error: e instanceof Error ? e.message : 'unknown' }
    }
  }

  const allOk = Object.values(checks).every((c) => c.ok)

  return NextResponse.json(
    {
      ok: allOk,
      service: 'seo-control-plane',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      env: {
        supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        register_secret: !!process.env.SCP_REGISTER_SECRET,
        cron_secret: !!getCronSecret(),
        cron_secret_source: process.env.SCP_CRON_SECRET
          ? 'SCP_CRON_SECRET'
          : process.env.CRON_SECRET
            ? 'CRON_SECRET'
            : null,
      },
      checks,
    },
    { headers: { 'Cache-Control': 'no-cache, no-store' } }
  )
}
