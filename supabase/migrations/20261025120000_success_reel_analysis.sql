-- Shared analysis per success reel (one analysis serves every student), per-user saves,
-- and per-user plans ("내 기획안") generated from an analyzed reel.
alter table public.creator_success_reels
  add column analysis jsonb,
  add column analysis_status text not null default 'none' check (analysis_status in ('none', 'running', 'ready', 'failed')),
  add column analysis_error text,
  add column analysis_updated_at timestamptz;

create table public.creator_reel_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  shortcode text not null references public.creator_success_reels(shortcode) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shortcode)
);
create index creator_reel_saves_user on public.creator_reel_saves(user_id, created_at desc);
alter table public.creator_reel_saves enable row level security;
grant all on public.creator_reel_saves to service_role;

create table public.creator_reel_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shortcode text not null references public.creator_success_reels(shortcode) on delete cascade,
  brief text not null check (char_length(brief) between 5 and 4000),
  status text not null default 'running' check (status in ('running', 'ready', 'failed')),
  plan jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index creator_reel_plans_user on public.creator_reel_plans(user_id, created_at desc);
alter table public.creator_reel_plans enable row level security;
grant all on public.creator_reel_plans to service_role;
