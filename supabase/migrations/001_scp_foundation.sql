-- SEO Control Plane — core schema (prefix: scp_)
-- Apply in shared Supabase project; RLS on; service role used from Next.js API routes.

create table if not exists public.scp_apps (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  base_url text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scp_api_keys (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.scp_apps (id) on delete cascade,
  key_hash text not null,
  key_prefix text not null,
  label text not null default 'default',
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scp_api_keys_key_hash_key unique (key_hash)
);

create index if not exists scp_api_keys_app_id_idx on public.scp_api_keys (app_id);

create table if not exists public.scp_content_requests (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.scp_apps (id) on delete cascade,
  requested_count int not null check (requested_count >= 1 and requested_count <= 100),
  status text not null default 'open',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists scp_content_requests_app_status_idx
  on public.scp_content_requests (app_id, status, created_at desc);

create table if not exists public.scp_articles (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.scp_apps (id) on delete cascade,
  slug text not null,
  title text not null,
  description text,
  status text not null default 'draft',
  body_mdx text,
  meta_json jsonb not null default '{}',
  scheduled_publish_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scp_articles_app_slug_key unique (app_id, slug)
);

create index if not exists scp_articles_app_status_idx on public.scp_articles (app_id, status);
create index if not exists scp_articles_scheduled_idx on public.scp_articles (app_id, scheduled_publish_at);

create table if not exists public.scp_publish_queue (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.scp_articles (id) on delete cascade,
  position int not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists scp_publish_queue_article_idx on public.scp_publish_queue (article_id);
create index if not exists scp_publish_queue_scheduled_idx on public.scp_publish_queue (scheduled_for, status);

create table if not exists public.scp_analytics_events (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.scp_apps (id) on delete cascade,
  article_id uuid references public.scp_articles (id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}',
  client_event_id text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists scp_analytics_events_dedupe_idx
  on public.scp_analytics_events (app_id, client_event_id)
  where client_event_id is not null;

create index if not exists scp_analytics_events_app_time_idx
  on public.scp_analytics_events (app_id, occurred_at desc);

alter table public.scp_apps enable row level security;
alter table public.scp_api_keys enable row level security;
alter table public.scp_content_requests enable row level security;
alter table public.scp_articles enable row level security;
alter table public.scp_publish_queue enable row level security;
alter table public.scp_analytics_events enable row level security;

-- No anon policies: API uses service role only for MVP. Add authenticated policies when dashboard uses user-scoped access.

comment on table public.scp_apps is 'Registered Vercel base apps (EverReach, etc.)';
comment on table public.scp_api_keys is 'Hashed API keys for base app → control plane calls';
comment on table public.scp_content_requests is 'I need more blogs — batch requests';
comment on table public.scp_articles is 'Article drafts and publish state';
comment on table public.scp_publish_queue is 'Staggered publish slots throughout the day';
comment on table public.scp_analytics_events is 'Ingested events from base apps for ranking/learning loop';
