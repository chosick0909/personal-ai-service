-- Coupon-based access control for HookAI beta and student plans.

create extension if not exists pgcrypto;

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  type text not null check (type in ('open_beta', 'student')),
  active boolean not null default true,
  max_redemptions integer,
  redeemed_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.user_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  coupon_id uuid references public.coupons(id) on delete set null,
  plan_type text not null check (plan_type in ('open_beta', 'student', 'paid')),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlement_limits (
  entitlement_id uuid primary key references public.user_entitlements(id) on delete cascade,
  monthly_reference_limit integer,
  per_reference_copilot_limit integer,
  per_reference_feedback_limit integer,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  entitlement_id uuid references public.user_entitlements(id) on delete set null,
  reference_id uuid,
  event_type text not null check (event_type in ('reference_analysis', 'copilot_message', 'feedback_request')),
  created_at timestamptz not null default now()
);

create index if not exists user_entitlements_user_active_idx
  on public.user_entitlements (user_id, status, starts_at, ends_at, created_at desc);

create unique index if not exists user_entitlements_user_coupon_unique_idx
  on public.user_entitlements (user_id, coupon_id)
  where coupon_id is not null;

create index if not exists usage_events_user_entitlement_type_created_idx
  on public.usage_events (user_id, entitlement_id, event_type, created_at desc);

create index if not exists usage_events_user_reference_type_created_idx
  on public.usage_events (user_id, reference_id, event_type, created_at desc)
  where reference_id is not null;

insert into public.coupons (code, type, active, max_redemptions)
values
  ('WELCOME2OPENBETA_0425', 'open_beta', true, null),
  ('WELCOME2INSTACAMPUS_0425', 'student', true, null)
on conflict (code) do update set
  type = excluded.type,
  active = excluded.active,
  max_redemptions = excluded.max_redemptions;
