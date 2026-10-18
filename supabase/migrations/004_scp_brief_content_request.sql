-- Link content briefs back to batch requests (allocate → generate → fulfill)

alter table public.scp_content_briefs
  add column if not exists content_request_id uuid references public.scp_content_requests (id) on delete set null;

create index if not exists scp_briefs_content_request_idx
  on public.scp_content_briefs (content_request_id)
  where content_request_id is not null;
