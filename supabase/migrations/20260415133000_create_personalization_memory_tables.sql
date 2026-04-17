create table if not exists public.memory_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  scope text not null check (scope in ('global', 'character', 'session')),
  session_id text not null default '',
  type text not null,
  value text not null,
  confidence numeric not null default 0.7,
  last_seen timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists memory_events_unique_idx
  on public.memory_events (account_id, scope, session_id, type, value);

create index if not exists memory_events_account_scope_last_seen_idx
  on public.memory_events (account_id, scope, last_seen desc);

create table if not exists public.session_memory (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  session_id text not null,
  summary text not null default '',
  recent_messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists session_memory_unique_idx
  on public.session_memory (account_id, session_id);

create index if not exists session_memory_account_updated_at_idx
  on public.session_memory (account_id, updated_at desc);
