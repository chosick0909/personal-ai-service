-- 캐러셀 만들기: a carousel plan from the cover title to the designed slides, kept apart from the reel plans
-- (studio_sessions) so the reel flow students use is not touched. Open to listed accounts only at first.
create table public.studio_carousels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null default 'cover' check (stage in ('cover', 'body', 'slides', 'design', 'caption', 'done')),
  title text,
  brief text not null default '',
  -- References by slot: structure (a carousel's slide order or a reel's flow), design (a carousel's frame and colours), caption.
  sources jsonb not null default '{}'::jsonb,
  topic jsonb,
  cover jsonb,
  body jsonb,
  slides jsonb,
  design jsonb,
  caption jsonb,
  style_snapshot jsonb,
  job_stage text,
  job_status text not null default 'idle' check (job_status in ('idle', 'running', 'failed')),
  job_error text,
  job_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index studio_carousels_user on public.studio_carousels(user_id, updated_at desc);
alter table public.studio_carousels enable row level security;
grant all on public.studio_carousels to service_role;

-- 내 이미지 보관함: photos the student uploaded, AI images they made, stock photos they placed. One library for
-- every carousel. sha256 keeps the same file from being stored twice; kept=false marks an AI image nobody chose yet
-- (removed after seven days).
create table public.studio_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('upload', 'ai', 'stock')),
  path text not null,
  thumb_path text,
  width integer,
  height integer,
  bytes integer not null default 0,
  sha256 text,
  -- AI images: the tier that made it (economy / standard / infographic) and what was asked for.
  tier text,
  prompt text,
  tags text[] not null default '{}',
  kept boolean not null default true,
  created_at timestamptz not null default now()
);
create index studio_images_user on public.studio_images(user_id, created_at desc);
create unique index studio_images_user_sha on public.studio_images(user_id, sha256) where sha256 is not null;
alter table public.studio_images enable row level security;
grant all on public.studio_images to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('studio-images', 'studio-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
