-- 훅ai's daily study: what it knows about each field (terms, audience, hooks and structures that work),
-- rewritten each morning from the analyzed success reels, and a log of each study run.
create table public.creator_field_knowledge (
  category text primary key,
  knowledge jsonb not null,
  reel_count integer not null default 0,
  built_at timestamptz not null default now()
);
alter table public.creator_field_knowledge enable row level security;
grant all on public.creator_field_knowledge to service_role;

create table public.creator_study_runs (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}',
  error text
);
create index creator_study_runs_started on public.creator_study_runs(started_at desc);
alter table public.creator_study_runs enable row level security;
grant all on public.creator_study_runs to service_role;
