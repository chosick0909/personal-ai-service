-- 주제 찾기: conversations with 훅ai only about finding a topic, and the topics a student saves to plan later.
create table public.studio_idea_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  category text,
  research jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_idea_threads_user on public.studio_idea_threads(user_id, updated_at desc);
alter table public.studio_idea_threads enable row level security;
grant all on public.studio_idea_threads to service_role;

create table public.studio_idea_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.studio_idea_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'hookai')),
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index studio_idea_messages_thread on public.studio_idea_messages(thread_id, created_at);
alter table public.studio_idea_messages enable row level security;
grant all on public.studio_idea_messages to service_role;

create table public.studio_saved_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.studio_idea_threads(id) on delete set null,
  title text not null,
  angle text not null default '',
  promise text not null default '',
  why text not null default '',
  materials jsonb not null default '[]'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  category text,
  reels jsonb not null default '[]'::jsonb,
  research jsonb,
  memo text not null default '',
  session_id uuid references public.studio_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_saved_topics_user on public.studio_saved_topics(user_id, created_at desc);
alter table public.studio_saved_topics enable row level security;
grant all on public.studio_saved_topics to service_role;
