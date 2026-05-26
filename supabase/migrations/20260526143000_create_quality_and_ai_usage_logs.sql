create extension if not exists pgcrypto;

create table if not exists public.copilot_quality_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  user_id uuid,
  reference_id uuid,
  script_id uuid,
  script_version_id uuid,
  session_id text,
  event_type text not null check (
    event_type in (
      'suggestion_created',
      'suggestion_applied',
      'feedback_created',
      'feedback_applied',
      'reply_only',
      'failed'
    )
  ),
  user_request text,
  intent text,
  operation_type text,
  edit_target text,
  changed_sections text[] not null default '{}',
  quality_gate jsonb not null default '{}'::jsonb,
  edit_plan_summary jsonb not null default '{}'::jsonb,
  latency_ms integer,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid,
  user_id uuid,
  reference_id uuid,
  session_id text,
  operation text not null,
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 8),
  latency_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists copilot_quality_events_created_idx
  on public.copilot_quality_events (created_at desc);

create index if not exists copilot_quality_events_account_created_idx
  on public.copilot_quality_events (account_id, created_at desc)
  where account_id is not null;

create index if not exists copilot_quality_events_reference_created_idx
  on public.copilot_quality_events (reference_id, created_at desc)
  where reference_id is not null;

create index if not exists copilot_quality_events_type_created_idx
  on public.copilot_quality_events (event_type, created_at desc);

create index if not exists ai_usage_logs_created_idx
  on public.ai_usage_logs (created_at desc);

create index if not exists ai_usage_logs_account_created_idx
  on public.ai_usage_logs (account_id, created_at desc)
  where account_id is not null;

create index if not exists ai_usage_logs_operation_created_idx
  on public.ai_usage_logs (operation, created_at desc);

alter table public.copilot_quality_events enable row level security;
alter table public.ai_usage_logs enable row level security;

drop policy if exists "Service role full access copilot_quality_events"
on public.copilot_quality_events;

create policy "Service role full access copilot_quality_events"
on public.copilot_quality_events
for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role full access ai_usage_logs"
on public.ai_usage_logs;

create policy "Service role full access ai_usage_logs"
on public.ai_usage_logs
for all
to service_role
using (true)
with check (true);
