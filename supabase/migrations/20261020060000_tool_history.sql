-- Tool outputs are separate from reference analyses and do not create usage events.
create table public.tool_history (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null check (kind in ('caption','thumbnail')),
  title text not null check (length(title) between 1 and 120),
  input jsonb not null,
  result jsonb not null,
  edited_caption text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tool_history_owner_recent on public.tool_history(user_id,account_id,updated_at desc);
alter table public.tool_history enable row level security;
-- Writes go through authenticated API with account/project ownership and version checks.
revoke all on public.tool_history from anon, authenticated;
grant all on public.tool_history to service_role;
