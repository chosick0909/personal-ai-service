create extension if not exists pgcrypto;

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.notes enable row level security;

create policy "Allow public read notes"
on public.notes
for select
to anon, authenticated
using (true);

create policy "Allow service role full access to notes"
on public.notes
for all
to service_role
using (true)
with check (true);
