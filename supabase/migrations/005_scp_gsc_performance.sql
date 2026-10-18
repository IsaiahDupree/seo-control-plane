-- Daily (or per-sync) Search Console query metrics pushed via POST /keywords/gsc-sync

create table if not exists public.scp_gsc_performance (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.scp_apps (id) on delete cascade,
  gsc_query text not null,
  clicks int not null default 0,
  impressions int not null default 0,
  ctr numeric(8, 6),
  position numeric(8, 3),
  date date not null,
  created_at timestamptz not null default now(),
  constraint scp_gsc_perf_app_query_date unique (app_id, gsc_query, date)
);

create index if not exists scp_gsc_perf_app_date_idx
  on public.scp_gsc_performance (app_id, date desc);

alter table public.scp_gsc_performance enable row level security;

comment on table public.scp_gsc_performance is 'GSC query rows ingested from base app or worker; complements scp_keywords metrics';
