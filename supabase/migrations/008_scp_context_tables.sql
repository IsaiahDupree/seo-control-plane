-- ─── 008: App Context Tables (F-CP-002 through F-CP-005, F-CP-008) ────────────

-- scp_app_features: product context (F-CP-002)
create table if not exists public.scp_app_features (
  id              uuid primary key default gen_random_uuid(),
  app_id          uuid not null references public.scp_apps(id) on delete cascade,
  tagline         text,
  one_liner       text,
  category        text,
  what_it_does    text,
  what_problem_it_solves text,
  differentiators text[]   not null default '{}',
  pricing_tiers   jsonb    not null default '[]',
  version         int      not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (app_id)
);

-- scp_app_personas: persona library (F-CP-003)
create table if not exists public.scp_app_personas (
  id          uuid primary key default gen_random_uuid(),
  app_id      uuid not null references public.scp_apps(id) on delete cascade,
  name        text not null,
  job_title   text,
  pain_points text[]  not null default '{}',
  goals       text[]  not null default '{}',
  objections  text[]  not null default '{}',
  vocabulary  text[]  not null default '{}',
  sort_order  int     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scp_app_personas_app_idx on public.scp_app_personas(app_id);

-- scp_app_ctas: CTA library (F-CP-004)
create table if not exists public.scp_app_ctas (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references public.scp_apps(id) on delete cascade,
  external_id    text,
  label          text not null,
  url            text not null,
  trigger_phrase text,
  placement      text check (placement in ('inline','end','sidebar','popup')),
  funnel_stage   text check (funnel_stage in ('awareness','consideration','conversion')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (app_id, external_id)
);
create index if not exists scp_app_ctas_app_idx on public.scp_app_ctas(app_id);

-- scp_app_restrictions: content restrictions (F-CP-005)
create table if not exists public.scp_app_restrictions (
  id                        uuid primary key default gen_random_uuid(),
  app_id                    uuid not null references public.scp_apps(id) on delete cascade,
  approved_claims           text[]  not null default '{}',
  prohibited_claims         text[]  not null default '{}',
  required_disclaimers      text[]  not null default '{}',
  competitor_mention_policy text    check (competitor_mention_policy in ('allow','neutral_only','prohibit')) default 'neutral_only',
  version                   int     not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (app_id)
);

-- scp_app_sync_logs: context version history (F-CP-008)
create table if not exists public.scp_app_sync_logs (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references public.scp_apps(id) on delete cascade,
  sync_type    text not null, -- 'product', 'personas', 'ctas', 'restrictions', 'publishing'
  version      int  not null default 1,
  snapshot     jsonb not null default '{}',
  performed_by text,
  created_at   timestamptz not null default now()
);
create index if not exists scp_app_sync_logs_app_idx on public.scp_app_sync_logs(app_id, sync_type, created_at desc);

-- scp_app_publishing: publishing window config (F-CP-009)
create table if not exists public.scp_app_publishing (
  id                  uuid primary key default gen_random_uuid(),
  app_id              uuid not null references public.scp_apps(id) on delete cascade,
  daily_publish_limit int  not null default 2,
  publish_start_hour  int  not null default 8  check (publish_start_hour between 0 and 23),
  publish_end_hour    int  not null default 18 check (publish_end_hour between 0 and 23),
  publish_days        int[] not null default '{1,2,3,4,5}', -- 0=Sun … 6=Sat
  min_interval_hours  int  not null default 4,
  timezone            text not null default 'UTC',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (app_id)
);

-- scp_article_publications: existing published content (F-CP-028 sitemap import)
create table if not exists public.scp_article_publications (
  id           uuid primary key default gen_random_uuid(),
  app_id       uuid not null references public.scp_apps(id) on delete cascade,
  url          text not null,
  slug         text,
  title        text,
  focus_keyword text,
  status       text not null default 'published',
  source       text not null default 'manual', -- 'sitemap_import', 'manual', 'scp_delivery'
  gsc_avg_position numeric(8,3),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (app_id, url)
);
create index if not exists scp_article_pubs_app_idx on public.scp_article_publications(app_id, status);

-- scp_competitors: competitor domain registry (F-CP-018)
create table if not exists public.scp_competitors (
  id             uuid primary key default gen_random_uuid(),
  app_id         uuid not null references public.scp_apps(id) on delete cascade,
  domain         text not null,
  display_name   text,
  why_competitor text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (app_id, domain)
);
create index if not exists scp_competitors_app_idx on public.scp_competitors(app_id);

-- scp_competitor_serps: SERP data per keyword (F-CP-045, F-CP-047)
create table if not exists public.scp_competitor_serps (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid not null references public.scp_apps(id) on delete cascade,
  keyword       text not null,
  competitor_domain text not null,
  rank_position int,
  page_url      text,
  page_title    text,
  fetched_at    timestamptz not null default now(),
  unique (app_id, keyword, competitor_domain)
);
create index if not exists scp_competitor_serps_app_idx on public.scp_competitor_serps(app_id, keyword);

-- Add opportunity_score to scp_keywords if not present
alter table public.scp_keywords
  add column if not exists opportunity_score numeric(10,4);

-- Add cluster_name to scp_keywords (denormalised convenience column) if not present
alter table public.scp_keywords
  add column if not exists cluster_name text;

-- RLS: service-role only (consistent with 007)
alter table public.scp_app_features    enable row level security;
alter table public.scp_app_personas    enable row level security;
alter table public.scp_app_ctas        enable row level security;
alter table public.scp_app_restrictions enable row level security;
alter table public.scp_app_sync_logs   enable row level security;
alter table public.scp_app_publishing  enable row level security;

alter table public.scp_article_publications enable row level security;
alter table public.scp_competitors           enable row level security;
alter table public.scp_competitor_serps      enable row level security;

create policy "scp_app_features_service_only"      on public.scp_app_features         for all using (false);
create policy "scp_app_personas_service_only"      on public.scp_app_personas         for all using (false);
create policy "scp_app_ctas_service_only"          on public.scp_app_ctas             for all using (false);
create policy "scp_app_restrictions_service_only"  on public.scp_app_restrictions     for all using (false);
create policy "scp_app_sync_logs_service_only"     on public.scp_app_sync_logs        for all using (false);
create policy "scp_app_publishing_service_only"    on public.scp_app_publishing       for all using (false);
create policy "scp_article_pubs_service_only"      on public.scp_article_publications for all using (false);
create policy "scp_competitors_service_only"       on public.scp_competitors          for all using (false);
create policy "scp_competitor_serps_service_only"  on public.scp_competitor_serps     for all using (false);
