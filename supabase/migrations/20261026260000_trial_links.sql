-- Client trial links: opening one signs the visitor in as the link's own trial account, which may use
-- Creator Studio 2 without a coupon until the link expires or is turned off. Only the key's SHA-256 is stored.
create table public.creator_demo_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.creator_demo_links enable row level security;
grant all on public.creator_demo_links to service_role;
