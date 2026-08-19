alter table public.reference_videos
  add column if not exists source_mode text,
  add column if not exists topic_brief jsonb not null default '{}'::jsonb;

update public.reference_videos
set source_mode = case
  when lower(coalesce(mime_type, '')) = 'text/plain' then 'script_text'
  else 'video'
end
where source_mode is null;

alter table public.reference_videos
  alter column source_mode set default 'video',
  alter column source_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reference_videos_source_mode_check'
      and conrelid = 'public.reference_videos'::regclass
  ) then
    alter table public.reference_videos
      add constraint reference_videos_source_mode_check
      check (source_mode in ('video', 'script_text', 'topic_only'));
  end if;
end
$$;

create index if not exists reference_videos_account_source_mode_created_idx
  on public.reference_videos (account_id, source_mode, created_at desc);

create unique index if not exists reference_videos_topic_only_idempotency_uidx
  on public.reference_videos (account_id, idempotency_key)
  where source_mode = 'topic_only' and idempotency_key is not null;

comment on column public.reference_videos.source_mode is
  'Input source used to create the analysis: video, script_text, or topic_only.';

comment on column public.reference_videos.topic_brief is
  'Structured planning brief shared by topic-only A/B/C script variations.';
