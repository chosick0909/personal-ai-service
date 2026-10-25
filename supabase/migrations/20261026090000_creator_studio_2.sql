-- Creator Studio 2: 훅ai plan sessions, chat, my references/formulas/style, and
-- analysis-request counts for the 인기순 sort. Visible only to flagged users at first.

-- 인기순: how many students asked for a reel's analysis (anonymous aggregate).
alter table public.creator_success_reels add column analysis_requests integer not null default 0;
update public.creator_success_reels r set analysis_requests = c.n
  from (select shortcode, count(*) as n from public.creator_reel_user_analyses group by shortcode) c
  where c.shortcode = r.shortcode;
create or replace function public.creator_reel_user_analyses_count() returns trigger language plpgsql as $$
begin
  update public.creator_success_reels set analysis_requests = analysis_requests + 1 where shortcode = new.shortcode;
  return new;
end $$;
create trigger creator_reel_user_analyses_count after insert on public.creator_reel_user_analyses
  for each row execute function public.creator_reel_user_analyses_count();

-- 내 레퍼런스 tags (후킹·전개·촬영편집·캡션 참고). Rows here are the student's library.
alter table public.creator_reel_user_analyses add column tags text[] not null default '{}';

-- 기획 세션: one 훅ai conversation from reference to caption.
create table public.studio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('single', 'mix', 'topic')),
  stage text not null default 'topic' check (stage in ('topic', 'thumbnail', 'hook', 'script', 'filming', 'caption', 'done')),
  title text,
  sources jsonb not null default '{}'::jsonb,
  brief text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  topic jsonb,
  thumbnail jsonb,
  hook jsonb,
  script jsonb,
  filming jsonb,
  caption jsonb,
  memo text not null default '',
  placeholders jsonb not null default '[]'::jsonb,
  ask jsonb,
  style_snapshot jsonb,
  job_stage text,
  job_status text not null default 'idle' check (job_status in ('idle', 'running', 'failed')),
  job_error text,
  job_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_sessions_user on public.studio_sessions(user_id, updated_at desc);
alter table public.studio_sessions enable row level security;
grant all on public.studio_sessions to service_role;

create table public.studio_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.studio_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'hookai')),
  stage text not null,
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index studio_messages_session on public.studio_messages(session_id, created_at);
alter table public.studio_messages enable row level security;
grant all on public.studio_messages to service_role;

-- 내 공식: saved hook/structure/filming/caption patterns.
create table public.studio_formulas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('hook', 'structure', 'filming', 'caption')),
  title text not null check (char_length(title) between 1 and 80),
  spec jsonb not null,
  example text not null default '',
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index studio_formulas_user on public.studio_formulas(user_id, created_at desc);
alter table public.studio_formulas enable row level security;
grant all on public.studio_formulas to service_role;

-- 내 말투.
create table public.studio_styles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  description text not null default '',
  choices jsonb not null default '{}'::jsonb,
  samples text not null default '',
  card jsonb,
  updated_at timestamptz not null default now()
);
alter table public.studio_styles enable row level security;
grant all on public.studio_styles to service_role;

-- 주제 기록: the only thing 훅ai remembers across plans.
create table public.studio_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.studio_sessions(id) on delete set null,
  topic text not null,
  category text,
  created_at timestamptz not null default now()
);
create index studio_topics_user on public.studio_topics(user_id, created_at desc);
alter table public.studio_topics enable row level security;
grant all on public.studio_topics to service_role;
