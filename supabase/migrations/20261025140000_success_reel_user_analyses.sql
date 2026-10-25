-- Which student asked for which reel analysis ("내가 분석한 릴스" and 최근 작업).
-- The analysis itself stays shared on creator_success_reels.
create table public.creator_reel_user_analyses (
  user_id uuid not null references auth.users(id) on delete cascade,
  shortcode text not null references public.creator_success_reels(shortcode) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, shortcode)
);
create index creator_reel_user_analyses_user on public.creator_reel_user_analyses(user_id, created_at desc);
alter table public.creator_reel_user_analyses enable row level security;
grant all on public.creator_reel_user_analyses to service_role;
