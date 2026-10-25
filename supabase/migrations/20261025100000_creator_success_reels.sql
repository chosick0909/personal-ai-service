-- Success reels archive: public Instagram reels with 500k+ views collected once a day
-- by the operator's collector. Only links, metrics, analysis and one thumbnail are kept;
-- video files are never stored. All writes go through the service role API.

create table public.creator_reel_accounts (
  username text primary key check (username ~ '^[a-zA-Z0-9_.]{1,30}$'),
  profile jsonb not null,
  review jsonb,
  review_version integer,
  eligible boolean not null default false,
  reject_reason text,
  reviewed_at timestamptz,
  last_seen_at timestamptz not null default now()
);
alter table public.creator_reel_accounts enable row level security;
grant all on public.creator_reel_accounts to service_role;

create table public.creator_success_reels (
  shortcode text primary key check (shortcode ~ '^[A-Za-z0-9_-]{5,40}$'),
  username text not null references public.creator_reel_accounts(username) on delete cascade,
  views bigint not null check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  posted_at timestamptz not null,
  caption text not null default '',
  caption_ko text,
  language text,
  region text check (region in ('domestic', 'overseas')),
  audio text,
  category text,
  face_visibility text not null default 'unknown' check (face_visibility in ('visible', 'hidden', 'mixed', 'unknown')),
  thumbnail_path text,
  source text,
  visible boolean not null default false,
  first_collected_at timestamptz not null default now(),
  last_collected_at timestamptz not null default now()
);
create index creator_success_reels_latest on public.creator_success_reels(visible, posted_at desc);
create index creator_success_reels_views on public.creator_success_reels(visible, views desc);
create index creator_success_reels_username on public.creator_success_reels(username);
alter table public.creator_success_reels enable row level security;
grant all on public.creator_success_reels to service_role;

create table public.creator_reel_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}',
  error text
);
alter table public.creator_reel_ingest_runs enable row level security;
grant all on public.creator_reel_ingest_runs to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('creator-reel-thumbnails', 'creator-reel-thumbnails', false, 2097152,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict(id) do nothing;
-- Thumbnails are served only through short-lived signed URLs. No public storage policies.
