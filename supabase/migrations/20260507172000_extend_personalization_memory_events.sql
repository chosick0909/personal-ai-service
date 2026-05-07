alter table public.memory_events
  add column if not exists weight integer not null default 1,
  add column if not exists source text not null default 'chat',
  add column if not exists hits integer not null default 1,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists memory_events_account_scope_weight_seen_idx
  on public.memory_events (account_id, scope, weight desc, last_seen desc);

create index if not exists memory_events_account_type_weight_seen_idx
  on public.memory_events (account_id, type, weight desc, last_seen desc);
