-- Link articles to briefs and batch content requests (generation pipeline)

alter table public.scp_articles
  add column if not exists brief_id uuid references public.scp_content_briefs (id) on delete set null,
  add column if not exists content_request_id uuid references public.scp_content_requests (id) on delete set null;

create index if not exists scp_articles_brief_id_idx on public.scp_articles (brief_id)
  where brief_id is not null;

create index if not exists scp_articles_content_request_idx on public.scp_articles (content_request_id)
  where content_request_id is not null;
