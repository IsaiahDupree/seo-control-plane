-- ─── 006: Addendum — constraints, columns, and indices added by new features ──

-- 1. Unique constraint on internal link edges (required by upsert in lib/internal-links.ts)
alter table public.scp_internal_link_edges
  add constraint scp_links_unique_pair unique (from_article_id, to_article_id);

-- 2. scp_apps: monthly article tracking columns (required by monthly-reset cron)
alter table public.scp_apps
  add column if not exists monthly_articles_generated int not null default 0,
  add column if not exists quota_reset_at timestamptz;

-- 3. scp_apps: base_url column for internal link URL building
alter table public.scp_apps
  add column if not exists base_url text;

-- 4. scp_gsc_performance: column name normalisation
--    The cron/gsc-pull route writes `query` + `page_url` + `slug`; ensure they exist.
alter table public.scp_gsc_performance
  add column if not exists query     text,
  add column if not exists page_url  text,
  add column if not exists slug      text,
  add column if not exists avg_position numeric(8, 3);

-- Rename gsc_query → query if the old column still exists (idempotent via DO block)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'scp_gsc_performance'
      and column_name  = 'gsc_query'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'scp_gsc_performance'
      and column_name  = 'query'
  ) then
    alter table public.scp_gsc_performance rename column gsc_query to query;
  end if;
end $$;

-- Drop old unique constraint and add new one that includes query instead of gsc_query
alter table public.scp_gsc_performance
  drop constraint if exists scp_gsc_perf_app_query_date;

alter table public.scp_gsc_performance
  add constraint scp_gsc_perf_app_query_date unique (app_id, query, date);

-- 5. Additional index for refresh queue priority ordering (already in 002 but safe to re-add)
create index if not exists scp_refresh_priority_app_idx
  on public.scp_refresh_queue (app_id, priority_score desc)
  where status = 'queued';

-- 6. scp_articles: target_word_count column used by refresh-queue re-generation
alter table public.scp_articles
  add column if not exists target_word_count int;
