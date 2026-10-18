-- ─── 009: New columns and tables for routes built in this session ─────────────

-- 1. scp_apps: domain verification, owner, quota reset
alter table public.scp_apps
  add column if not exists owner_id                   uuid,
  add column if not exists domain_verified            boolean not null default false,
  add column if not exists domain_verified_at         timestamptz,
  add column if not exists domain_verification_token  text,
  add column if not exists quota_override_at          timestamptz;

-- 2. scp_articles: GSC columns used by freshness, indexing, perf-alert routes
alter table public.scp_articles
  add column if not exists gsc_avg_position  numeric(8,3),
  add column if not exists gsc_clicks        int,
  add column if not exists gsc_impressions   int,
  add column if not exists gsc_ctr           numeric(8,6);

-- 3. scp_keywords: columns used by new keyword routes
alter table public.scp_keywords
  add column if not exists updated_at        timestamptz not null default now(),
  add column if not exists opportunity_score numeric(5,2),
  add column if not exists intent_type       text
    check (intent_type in ('informational','navigational','commercial','transactional')),
  add column if not exists is_brand_term     boolean not null default false,
  add column if not exists is_competitor_term boolean not null default false,
  add column if not exists competition       numeric(5,4),
  add column if not exists cpc_trend        jsonb;

-- Rename intent → intent_type if old column exists (idempotent)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scp_keywords' and column_name = 'intent'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scp_keywords' and column_name = 'intent_type'
  ) then
    alter table public.scp_keywords rename column intent to intent_type;
  end if;
end $$;

-- Rename priority_score → opportunity_score if old column exists (idempotent)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scp_keywords' and column_name = 'priority_score'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scp_keywords' and column_name = 'opportunity_score'
  ) then
    alter table public.scp_keywords rename column priority_score to opportunity_score;
  end if;
end $$;

-- Update status check constraint on scp_keywords to support new statuses
alter table public.scp_keywords
  drop constraint if exists scp_keywords_status_check;

alter table public.scp_keywords
  add constraint scp_keywords_status_check
    check (status in ('active','paused','archived','excluded','unassigned',
                      'brief_created','assigned','published'));

-- 4. scp_gsc_performance: avg_position alias (already in 006 but harmless if re-added)
alter table public.scp_gsc_performance
  add column if not exists avg_position numeric(8,3);

-- 5. scp_content_requests: priority and priority_score columns
alter table public.scp_content_requests
  add column if not exists priority        text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  add column if not exists priority_score  int not null default 50,
  add column if not exists status          text not null default 'open',
  add column if not exists updated_at      timestamptz not null default now();

-- 6. scp_publish_queue: add app_id FK for queue controls (if missing)
alter table public.scp_publish_queue
  add column if not exists app_id    uuid references public.scp_apps(id) on delete cascade,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists scp_publish_queue_app_status_idx
  on public.scp_publish_queue(app_id, status);

-- 7. scp_competitors: table for competitor domain registration (F-CP-018)
create table if not exists public.scp_competitors (
  id               uuid primary key default gen_random_uuid(),
  app_id           uuid not null references public.scp_apps(id) on delete cascade,
  domain           text not null,
  display_name     text,
  why_competitor   text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (app_id, domain)
);

create index if not exists scp_competitors_app_idx on public.scp_competitors(app_id);
alter table public.scp_competitors enable row level security;
create policy "scp_competitors_service_only" on public.scp_competitors for all using (false);

-- 8. scp_competitor_serps: competitor SERP snapshots (F-CP-050 / F-CP-019)
create table if not exists public.scp_competitor_serps (
  id                uuid primary key default gen_random_uuid(),
  app_id            uuid not null references public.scp_apps(id) on delete cascade,
  competitor_domain text not null,
  keyword           text not null,
  rank_position     int  not null,
  page_url          text,
  page_title        text,
  fetched_at        timestamptz not null default now(),
  unique (app_id, competitor_domain, keyword, fetched_at)
);

create index if not exists scp_comp_serps_app_kw_idx on public.scp_competitor_serps(app_id, keyword);
create index if not exists scp_comp_serps_domain_idx on public.scp_competitor_serps(app_id, competitor_domain, fetched_at desc);
alter table public.scp_competitor_serps enable row level security;
create policy "scp_competitor_serps_service_only" on public.scp_competitor_serps for all using (false);

-- 9. scp_content_pillars: pillar hierarchy table (F-CP-034)
create table if not exists public.scp_content_pillars (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid not null references public.scp_apps(id) on delete cascade,
  name        text not null,
  slug        text not null,
  parent_slug text,
  description text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (app_id, slug)
);

create index if not exists scp_pillars_app_idx on public.scp_content_pillars(app_id);
alter table public.scp_content_pillars enable row level security;
create policy "scp_content_pillars_service_only" on public.scp_content_pillars for all using (false);

-- 10. scp_audit_log: alias/synonym for scp_user_audit_log used by some routes
--     Create a view so routes querying scp_audit_log still work.
create or replace view public.scp_audit_log as
  select * from public.scp_user_audit_log;

-- 11. Index: articles by published_at for stale detection cron
create index if not exists scp_articles_published_at_idx
  on public.scp_articles(app_id, published_at asc)
  where published_at is not null;

-- 12. Index: keywords by opportunity_score for bulk-generate and article-map routes
create index if not exists scp_keywords_opportunity_idx
  on public.scp_keywords(app_id, opportunity_score desc nulls last)
  where status = 'active';
