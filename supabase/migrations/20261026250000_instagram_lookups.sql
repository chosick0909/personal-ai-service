-- Instagram lookups answered by the operator's Mac mini instead of a paid data service.
-- The server queues a reel; the Mac mini claims the most urgent one (lowest priority number, oldest first).
create table public.creator_instagram_lookups (
  id uuid primary key default gen_random_uuid(),
  shortcode text not null check (shortcode ~ '^[A-Za-z0-9_-]{5,40}$'),
  url text not null,
  priority smallint not null default 1,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed')),
  result jsonb,
  error text,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index creator_instagram_lookups_queue on public.creator_instagram_lookups(status, priority, created_at);
create index creator_instagram_lookups_shortcode on public.creator_instagram_lookups(shortcode, created_at desc);
alter table public.creator_instagram_lookups enable row level security;
grant all on public.creator_instagram_lookups to service_role;

-- A request nobody waits for any more (15 minutes) is skipped; a claim the Mac mini dropped is retried after 3 minutes.
create function public.creator_claim_lookup()
returns setof public.creator_instagram_lookups language sql security invoker set search_path = '' as $$
  update public.creator_instagram_lookups set status = 'claimed', claimed_at = now(), attempts = attempts + 1
  where id = (
    select id from public.creator_instagram_lookups
    where created_at > now() - interval '15 minutes'
      and (status = 'queued' or (status = 'claimed' and claimed_at < now() - interval '3 minutes' and attempts < 3))
    order by priority, created_at limit 1 for update skip locked)
  returning *;
$$;
revoke all on function public.creator_claim_lookup() from public, anon, authenticated;
grant execute on function public.creator_claim_lookup() to service_role;
