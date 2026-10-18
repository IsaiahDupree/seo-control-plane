-- ─── 007: RLS Policies for all scp_ tables ────────────────────────────────────
-- All SCP tables use service-role access from Next.js API routes.
-- Anon/authenticated users should have NO direct access.
-- These policies are intentionally restrictive; all access flows through the API.

-- scp_apps
create policy "scp_apps_service_only"
  on public.scp_apps for all
  using (false);

-- scp_api_keys
create policy "scp_api_keys_service_only"
  on public.scp_api_keys for all
  using (false);

-- scp_articles
create policy "scp_articles_service_only"
  on public.scp_articles for all
  using (false);

-- scp_content_requests
create policy "scp_content_requests_service_only"
  on public.scp_content_requests for all
  using (false);

-- scp_analytics_events
create policy "scp_analytics_events_service_only"
  on public.scp_analytics_events for all
  using (false);

-- scp_keywords
create policy "scp_keywords_service_only"
  on public.scp_keywords for all
  using (false);

-- scp_content_briefs
create policy "scp_content_briefs_service_only"
  on public.scp_content_briefs for all
  using (false);

-- scp_qa_reports
create policy "scp_qa_reports_service_only"
  on public.scp_qa_reports for all
  using (false);

-- scp_deliveries
create policy "scp_deliveries_service_only"
  on public.scp_deliveries for all
  using (false);

-- scp_generation_jobs
create policy "scp_generation_jobs_service_only"
  on public.scp_generation_jobs for all
  using (false);

-- scp_gsc_performance
create policy "scp_gsc_performance_service_only"
  on public.scp_gsc_performance for all
  using (false);

-- scp_refresh_queue
create policy "scp_refresh_queue_service_only"
  on public.scp_refresh_queue for all
  using (false);

-- scp_internal_link_edges
create policy "scp_internal_link_edges_service_only"
  on public.scp_internal_link_edges for all
  using (false);

-- scp_publish_logs
create policy "scp_publish_logs_service_only"
  on public.scp_publish_logs for all
  using (false);

-- scp_article_performance
create policy "scp_article_performance_service_only"
  on public.scp_article_performance for all
  using (false);

-- scp_experiments
create policy "scp_experiments_service_only"
  on public.scp_experiments for all
  using (false);

-- scp_publish_queue
create policy "scp_publish_queue_service_only"
  on public.scp_publish_queue for all
  using (false);

-- scp_user_audit_log
create policy "scp_user_audit_log_service_only"
  on public.scp_user_audit_log for all
  using (false);
