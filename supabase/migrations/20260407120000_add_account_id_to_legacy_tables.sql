create extension if not exists pgcrypto;

insert into public.accounts (slug, name)
values ('legacy-mvp', 'Legacy MVP Account')
on conflict (slug) do nothing;

create or replace function public.legacy_default_account_id()
returns uuid
language sql
stable
as $$
  select id
  from public.accounts
  where slug = 'legacy-mvp'
  limit 1;
$$;

alter table public.documents
  add column if not exists account_id uuid;

alter table public.chunks
  add column if not exists account_id uuid;

alter table public.reference_videos
  add column if not exists account_id uuid;

update public.documents
set account_id = public.legacy_default_account_id()
where account_id is null;

update public.chunks c
set account_id = d.account_id
from public.documents d
where c.document_id = d.id
  and c.account_id is null;

update public.reference_videos
set account_id = public.legacy_default_account_id()
where account_id is null;

alter table public.documents
  alter column account_id set default public.legacy_default_account_id();

alter table public.chunks
  alter column account_id set default public.legacy_default_account_id();

alter table public.reference_videos
  alter column account_id set default public.legacy_default_account_id();

alter table public.documents
  alter column account_id set not null;

alter table public.chunks
  alter column account_id set not null;

alter table public.reference_videos
  alter column account_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_account_id_fkey'
  ) then
    alter table public.documents
      add constraint documents_account_id_fkey
      foreign key (account_id)
      references public.accounts(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chunks_account_id_fkey'
  ) then
    alter table public.chunks
      add constraint chunks_account_id_fkey
      foreign key (account_id)
      references public.accounts(id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reference_videos_account_id_fkey'
  ) then
    alter table public.reference_videos
      add constraint reference_videos_account_id_fkey
      foreign key (account_id)
      references public.accounts(id)
      on delete cascade;
  end if;
end $$;

create index if not exists documents_account_id_created_at_idx
  on public.documents (account_id, created_at desc);

create index if not exists chunks_account_id_document_id_idx
  on public.chunks (account_id, document_id, chunk_index);

create index if not exists reference_videos_account_id_created_at_idx
  on public.reference_videos (account_id, created_at desc);

alter table public.reference_analyses
  add column if not exists legacy_reference_video_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reference_analyses_legacy_reference_video_id_fkey'
  ) then
    alter table public.reference_analyses
      add constraint reference_analyses_legacy_reference_video_id_fkey
      foreign key (legacy_reference_video_id)
      references public.reference_videos(id)
      on delete set null;
  end if;
end $$;

create unique index if not exists reference_analyses_legacy_reference_video_id_uidx
  on public.reference_analyses (legacy_reference_video_id)
  where legacy_reference_video_id is not null;

comment on column public.reference_analyses.legacy_reference_video_id is
  'Bridge column for migrating legacy reference_videos rows into account-scoped reference_analyses.';

comment on function public.match_chunks(vector, int) is
  'DEPRECATED: legacy vector-only retrieval on public.chunks. Replace with match_global_knowledge_context and match_account_context.';
