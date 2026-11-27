-- 캐러셀을 기획안의 한 형식으로 합치기: a carousel is a studio session whose format is 'carousel'. It shares the reel
-- plan's topic conversation, questions, research, stage jobs and messages, and keeps its own stages after the topic
-- (cover, body, slides, design) in columns of their own. Everything here only adds, so the server running before this
-- (which never names these columns) keeps working; a plan it inserts is a reel by default.
alter table public.studio_sessions add column if not exists format text not null default 'reel';
alter table public.studio_sessions drop constraint if exists studio_sessions_format_check;
alter table public.studio_sessions add constraint studio_sessions_format_check check (format in ('reel', 'carousel'));
alter table public.studio_sessions add column if not exists cover jsonb;
alter table public.studio_sessions add column if not exists body jsonb;
alter table public.studio_sessions add column if not exists slides jsonb;
alter table public.studio_sessions add column if not exists design jsonb;
alter table public.studio_sessions drop constraint if exists studio_sessions_stage_check;
alter table public.studio_sessions add constraint studio_sessions_stage_check
  check (stage in ('topic', 'thumbnail', 'hook', 'script', 'filming', 'caption', 'done', 'cover', 'body', 'slides', 'design'));

-- The carousels made so far move over with their ids, so links to them keep opening. A carousel that was still
-- finding its topic (topic.talk, or no topic read yet) continues at the topic stage. Safe to run again: rows already
-- moved are skipped.
insert into public.studio_sessions (id, user_id, mode, format, stage, title, sources, brief, topic, cover, body, slides, design, caption,
  style_snapshot, job_stage, job_status, job_error, job_started_at, created_at, updated_at)
select c.id, c.user_id, 'topic', 'carousel', case when c.topic ->> 'talk' = 'true' or coalesce(c.topic ->> 'title', '') = '' then 'topic' else c.stage end, c.title, c.sources, c.brief,
  case when c.topic is null then null else c.topic - 'talk' end, c.cover, c.body, c.slides, c.design, c.caption,
  c.style_snapshot, c.job_stage, c.job_status, c.job_error, c.job_started_at, c.created_at, c.updated_at
from public.studio_carousels c
on conflict (id) do nothing;

insert into public.studio_messages (id, session_id, user_id, role, stage, content, meta, created_at)
select m.id, m.carousel_id, m.user_id, m.role, m.stage, m.content, m.meta, m.created_at
from public.studio_carousel_messages m
where exists (select 1 from public.studio_sessions s where s.id = m.carousel_id)
on conflict (id) do nothing;

-- studio_carousels and studio_carousel_messages are left in place as the copy to fall back on; nothing reads them now.
