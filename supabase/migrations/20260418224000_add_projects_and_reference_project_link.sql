create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists projects_id_account_id_unique
  on public.projects (id, account_id);

create index if not exists projects_account_id_created_at_idx
  on public.projects (account_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_projects_updated_at'
  ) then
    create trigger set_projects_updated_at
    before update on public.projects
    for each row
    execute procedure public.set_updated_at();
  end if;
end
$$;

alter table public.reference_videos
  add column if not exists project_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reference_videos_project_account_fkey'
  ) then
    alter table public.reference_videos
      add constraint reference_videos_project_account_fkey
      foreign key (project_id, account_id)
      references public.projects(id, account_id)
      on delete set null;
  end if;
end
$$;

create index if not exists reference_videos_account_id_project_id_created_at_idx
  on public.reference_videos (account_id, project_id, created_at desc);
