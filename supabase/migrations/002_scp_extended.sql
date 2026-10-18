-- SEO Control Plane — Extended Schema (Migration 002)
-- Adds: keywords, content_briefs, qa_reports, deliveries, article_performance,
--       internal_link_edges, refresh_queue, experiments, publish_logs, user_audit_log
-- Extends: scp_apps (context, webhook fields), scp_articles (full content columns),
--           scp_analytics_events (session / device / geo fields)
-- Depends on: 001_scp_foundation.sql

-- ─── Extend scp_apps ─────────────────────────────────────────────────────────
alter table public.scp_apps
  add column if not exists domain          text,
  add column if not exists vercel_project_id text,
  add column if not exists table_prefix    text,
  add column if not exists webhook_url     text,
  add column if not exists webhook_secret  text,
  add column if not exists context         jsonb not null default '{}',
  add column if not exists plan            text not null default 'starter',
  add column if not exists monthly_article_limit int not null default 30,
  add column if not exists status          text not null default 'active';

-- ─── Extend scp_articles ─────────────────────────────────────────────────────
alter table public.scp_articles
  add column if not exists content_html        text,
  add column if not exists content_markdown    text,
  add column if not exists meta_title          text,
  add column if not exists meta_description    text,
  add column if not exists og_image_url        text,
  add column if not exists canonical_url       text,
  add column if not exists focus_keyword       text,
  add column if not exists secondary_keywords  text[] not null default '{}',
  add column if not exists content_type        text,
  add column if not exists cluster_name        text,
  add column if not exists word_count          int,
  add column if not exists reading_time_minutes int,
  add column if not exists author              jsonb not null default '{}',
  add column if not exists schema_json         jsonb not null default '{}',
  add column if not exists table_of_contents   jsonb not null default '[]',
  add column if not exists cta_blocks          jsonb not null default '[]',
  add column if not exists internal_links      jsonb not null default '[]',
  add column if not exists tags                text[] not null default '{}',
  add column if not exists qa_score            int,
  add column if not exists confidence_score    numeric(4,2),
  add column if not exists is_stub             boolean not null default false,
  add column if not exists is_visible          boolean not null default true,
  add column if not exists delivery_version    int not null default 0,
  add column if not exists llm_provider        text,
  add column if not exists llm_model           text,
  add column if not exists generation_cost_usd numeric(8,4),
  add column if not exists generation_tokens   int;

-- ─── Extend scp_analytics_events ─────────────────────────────────────────────
alter table public.scp_analytics_events
  add column if not exists session_id      uuid,
  add column if not exists user_id         uuid,
  add column if not exists event_type      text,
  add column if not exists event_data      jsonb not null default '{}',
  add column if not exists device_type     text,
  add column if not exists geo_country     text,
  add column if not exists referrer_domain text,
  add column if not exists utm_source      text,
  add column if not exists utm_medium      text,
  add column if not exists utm_campaign    text,
  add column if not exists sdk_version     text;

-- ─── Keywords ────────────────────────────────────────────────────────────────
create table if not exists public.scp_keywords (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  keyword         text not null,
  cluster_name    text,
  search_volume   int,
  difficulty      int check (difficulty between 0 and 100),
  cpc_usd         numeric(8,2),
  intent          text check (intent in ('informational','navigational','commercial','transactional')),
  priority_score  numeric(5,2),
  is_seed         boolean not null default false,
  article_id      uuid references public.scp_articles(id) on delete set null,
  status          text not null default 'unassigned'
                  check (status in ('unassigned','brief_created','assigned','published')),
  last_refreshed_at timestamptz,
  created_at      timestamptz not null default now(),
  constraint scp_keywords_unique_per_app unique (app_id, keyword)
);

create index if not exists scp_keywords_app_id_idx    on public.scp_keywords(app_id);
create index if not exists scp_keywords_cluster_idx   on public.scp_keywords(app_id, cluster_name);
create index if not exists scp_keywords_status_idx    on public.scp_keywords(app_id, status);

alter table public.scp_keywords enable row level security;

-- ─── Content Briefs ───────────────────────────────────────────────────────────
create table if not exists public.scp_content_briefs (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.scp_apps(id) on delete cascade,
  keyword_id          uuid references public.scp_keywords(id) on delete set null,
  article_id          uuid references public.scp_articles(id) on delete set null,
  focus_keyword       text not null,
  secondary_keywords  text[] not null default '{}',
  content_type        text not null
                      check (content_type in ('pillar','cluster','comparison','alternatives','faq','guide','case_study')),
  cluster_name        text,
  target_word_count   int not null default 2000,
  target_persona      text,
  competitor_urls     text[] not null default '{}',
  serp_analysis       jsonb,
  tone_notes          text,
  cta_guidance        text,
  status              text not null default 'pending'
                      check (status in ('pending','assigned','generating','complete')),
  created_at          timestamptz not null default now()
);

create index if not exists scp_briefs_app_id_idx  on public.scp_content_briefs(app_id);
create index if not exists scp_briefs_status_idx  on public.scp_content_briefs(status);

alter table public.scp_content_briefs enable row level security;

-- ─── QA Reports ───────────────────────────────────────────────────────────────
create table if not exists public.scp_qa_reports (
  id                uuid primary key default gen_random_uuid(),
  article_id        uuid not null references public.scp_articles(id) on delete cascade,
  app_id            uuid not null references public.scp_apps(id) on delete cascade,
  overall_score     int not null check (overall_score between 0 and 100),
  quality_score     int,
  seo_score         int,
  readability_score int,
  checks_passed     text[] not null default '{}',
  checks_failed     text[] not null default '{}',
  blocking_issues   text[] not null default '{}',
  warnings          text[] not null default '{}',
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  outcome           text check (outcome in ('approved','rejected','needs_revision')),
  created_at        timestamptz not null default now()
);

create index if not exists scp_qa_reports_article_idx on public.scp_qa_reports(article_id);
create index if not exists scp_qa_reports_app_idx     on public.scp_qa_reports(app_id);

alter table public.scp_qa_reports enable row level security;

-- ─── Deliveries ───────────────────────────────────────────────────────────────
create table if not exists public.scp_deliveries (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  article_id      uuid not null references public.scp_articles(id) on delete cascade,
  version         int not null default 1,
  status          text not null default 'pending'
                  check (status in ('pending','delivered','failed','confirmed')),
  delivery_type   text not null default 'article'
                  check (delivery_type in ('article','refresh','command')),
  payload_size_bytes int,
  attempts        int not null default 0,
  last_attempt_at timestamptz,
  delivered_at    timestamptz,
  confirmed_at    timestamptz,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index if not exists scp_deliveries_app_id_idx    on public.scp_deliveries(app_id);
create index if not exists scp_deliveries_article_id_idx on public.scp_deliveries(article_id);
create index if not exists scp_deliveries_status_idx    on public.scp_deliveries(status);

alter table public.scp_deliveries enable row level security;

-- ─── Article Performance (daily aggregates) ───────────────────────────────────
create table if not exists public.scp_article_performance (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  article_id      uuid not null references public.scp_articles(id) on delete cascade,
  date            date not null,
  sessions        int not null default 0,
  pageviews       int not null default 0,
  avg_scroll_depth numeric(5,2),
  reads_complete  int not null default 0,
  cta_clicks      int not null default 0,
  conversions     int not null default 0,
  attributed_revenue_usd numeric(10,2) not null default 0,
  avg_position    numeric(5,2),
  impressions     int not null default 0,
  clicks          int not null default 0,
  ctr             numeric(5,4),
  created_at      timestamptz not null default now(),
  constraint scp_article_perf_unique unique (article_id, date)
);

create index if not exists scp_perf_app_date_idx on public.scp_article_performance(app_id, date desc);

alter table public.scp_article_performance enable row level security;

-- ─── Internal Link Edges ──────────────────────────────────────────────────────
create table if not exists public.scp_internal_link_edges (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.scp_apps(id) on delete cascade,
  from_article_id     uuid not null references public.scp_articles(id) on delete cascade,
  to_article_id       uuid references public.scp_articles(id) on delete set null,
  to_slug             text not null,
  anchor_text         text not null,
  position_in_article text check (position_in_article in ('top_third','middle_third','bottom_third')),
  is_pillar_link      boolean not null default false,
  inserted_by         text not null check (inserted_by in ('generation','refresh','human')),
  semantic_score      numeric(4,2),
  created_at          timestamptz not null default now()
);

create index if not exists scp_links_from_idx on public.scp_internal_link_edges(from_article_id);
create index if not exists scp_links_to_idx   on public.scp_internal_link_edges(to_article_id);
create index if not exists scp_links_app_idx  on public.scp_internal_link_edges(app_id);

alter table public.scp_internal_link_edges enable row level security;

-- ─── Refresh Queue ────────────────────────────────────────────────────────────
create table if not exists public.scp_refresh_queue (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  article_id      uuid not null references public.scp_articles(id) on delete cascade,
  reason          text not null,
  decay_signals   jsonb not null default '[]',
  priority_score  numeric(5,2) not null default 50,
  status          text not null default 'queued'
                  check (status in ('queued','generating','delivered','skipped')),
  queued_at       timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists scp_refresh_queue_app_status_idx on public.scp_refresh_queue(app_id, status);
create index if not exists scp_refresh_queue_priority_idx   on public.scp_refresh_queue(priority_score desc);

alter table public.scp_refresh_queue enable row level security;

-- ─── Experiments ──────────────────────────────────────────────────────────────
create table if not exists public.scp_experiments (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  article_id      uuid not null references public.scp_articles(id) on delete cascade,
  variant_type    text not null
                  check (variant_type in ('title','meta_description','cta_text','cta_position','h2_heading','intro_paragraph')),
  control_value   text not null,
  variant_value   text not null,
  status          text not null default 'running'
                  check (status in ('running','paused','concluded','cancelled')),
  winner          text check (winner in ('control','variant')),
  started_at      timestamptz not null default now(),
  concluded_at    timestamptz,
  control_conversions  int not null default 0,
  variant_conversions  int not null default 0,
  control_sessions     int not null default 0,
  variant_sessions     int not null default 0,
  significance_pct     numeric(5,2),
  created_at      timestamptz not null default now()
);

create index if not exists scp_experiments_app_idx     on public.scp_experiments(app_id);
create index if not exists scp_experiments_article_idx on public.scp_experiments(article_id);

alter table public.scp_experiments enable row level security;

-- ─── Publish Logs ─────────────────────────────────────────────────────────────
create table if not exists public.scp_publish_logs (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  article_id      uuid not null references public.scp_articles(id) on delete cascade,
  delivery_id     uuid references public.scp_deliveries(id) on delete set null,
  event_type      text not null
                  check (event_type in ('delivered','published','indexnow_pinged','gsc_submitted',
                                        'indexed_confirmed','unpublished','archived','redirected')),
  response_data   jsonb,
  occurred_at     timestamptz not null default now()
);

create index if not exists scp_publish_logs_article_idx on public.scp_publish_logs(article_id);
create index if not exists scp_publish_logs_app_idx     on public.scp_publish_logs(app_id, occurred_at desc);

alter table public.scp_publish_logs enable row level security;

-- ─── User Audit Log ───────────────────────────────────────────────────────────
create table if not exists public.scp_user_audit_log (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid references public.scp_apps(id) on delete cascade,
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  performed_by    uuid,
  performed_at    timestamptz not null default now(),
  payload         jsonb not null default '{}'
);

create index if not exists scp_audit_log_app_idx on public.scp_user_audit_log(app_id, performed_at desc);

alter table public.scp_user_audit_log enable row level security;

-- ─── Generation Jobs ──────────────────────────────────────────────────────────
create table if not exists public.scp_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  brief_id        uuid references public.scp_content_briefs(id) on delete set null,
  article_id      uuid references public.scp_articles(id) on delete set null,
  status          text not null default 'queued'
                  check (status in ('queued','running','complete','failed')),
  llm_provider    text,
  llm_model       text,
  total_tokens    int,
  cost_usd        numeric(8,4),
  error_message   text,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists scp_gen_jobs_app_idx    on public.scp_generation_jobs(app_id);
create index if not exists scp_gen_jobs_status_idx on public.scp_generation_jobs(status);

alter table public.scp_generation_jobs enable row level security;

-- ─── updated_at trigger (apps already has one from migration 001 if added) ────
create or replace function public.scp_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'scp_articles_updated_at'
  ) then
    create trigger scp_articles_updated_at
      before update on public.scp_articles
      for each row execute function public.scp_set_updated_at();
  end if;
end;
$$;
