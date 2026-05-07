create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  slug text,
  settings jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists characters_account_id_id_unique
  on public.characters (account_id, id);

create unique index if not exists characters_account_slug_unique
  on public.characters (account_id, slug)
  where slug is not null;

create unique index if not exists characters_account_default_unique
  on public.characters (account_id)
  where is_default = true;

create index if not exists characters_account_created_at_idx
  on public.characters (account_id, created_at desc);

alter table public.characters enable row level security;

drop policy if exists "Service role full access characters" on public.characters;
create policy "Service role full access characters"
on public.characters
for all
to service_role
using (true)
with check (true);

drop trigger if exists set_characters_updated_at on public.characters;
create trigger set_characters_updated_at
before update on public.characters
for each row
execute function public.set_updated_at();

insert into public.characters (account_id, name, slug, settings, is_default)
select
  a.id,
  a.name,
  a.slug,
  coalesce(ap.settings, '{}'::jsonb),
  true
from public.accounts a
left join public.account_profiles ap on ap.account_id = a.id
where not exists (
  select 1
  from public.characters c
  where c.account_id = a.id
    and c.is_default = true
);

alter table public.memory_events
  add column if not exists character_id uuid;

alter table public.session_memory
  add column if not exists character_id uuid;

update public.memory_events m
set character_id = c.id
from public.characters c
where c.account_id = m.account_id
  and c.is_default = true
  and m.scope in ('character', 'session')
  and m.character_id is null;

update public.session_memory s
set character_id = c.id
from public.characters c
where c.account_id = s.account_id
  and c.is_default = true
  and s.character_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'memory_events_account_character_fkey'
  ) then
    alter table public.memory_events
      add constraint memory_events_account_character_fkey
      foreign key (account_id, character_id)
      references public.characters (account_id, id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'session_memory_account_character_fkey'
  ) then
    alter table public.session_memory
      add constraint session_memory_account_character_fkey
      foreign key (account_id, character_id)
      references public.characters (account_id, id)
      on delete cascade;
  end if;
end $$;

drop index if exists memory_events_unique_idx;

create unique index if not exists memory_events_global_unique_idx
  on public.memory_events (account_id, scope, session_id, type, value)
  where character_id is null;

create unique index if not exists memory_events_character_unique_idx
  on public.memory_events (account_id, character_id, scope, session_id, type, value)
  where character_id is not null;

drop index if exists session_memory_unique_idx;

create unique index if not exists session_memory_character_unique_idx
  on public.session_memory (account_id, character_id, session_id)
  where character_id is not null;

create unique index if not exists session_memory_account_unique_idx
  on public.session_memory (account_id, session_id)
  where character_id is null;

create index if not exists memory_events_account_character_scope_weight_seen_idx
  on public.memory_events (account_id, character_id, scope, weight desc, last_seen desc);

create index if not exists session_memory_account_character_updated_at_idx
  on public.session_memory (account_id, character_id, updated_at desc);
