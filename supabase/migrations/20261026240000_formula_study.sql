-- 훅ai's common study: formulas it found that the built-in 공식 사전 lacks, which library entry each analyzed
-- success reel uses (its examples), and knowledge shared by every field (cover copy lessons).
create table public.creator_learned_formulas (
  id text primary key,
  kind text not null check (kind in ('hook', 'structure')),
  entry jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.creator_learned_formulas enable row level security;
grant all on public.creator_learned_formulas to service_role;

create table public.creator_reel_formulas (
  shortcode text primary key references public.creator_success_reels(shortcode) on delete cascade,
  hook_id text,
  structure_id text,
  checked_at timestamptz not null default now()
);
create index creator_reel_formulas_hook on public.creator_reel_formulas(hook_id);
create index creator_reel_formulas_structure on public.creator_reel_formulas(structure_id);
alter table public.creator_reel_formulas enable row level security;
grant all on public.creator_reel_formulas to service_role;

create table public.creator_common_knowledge (
  key text primary key,
  knowledge jsonb not null,
  source_count integer not null default 0,
  built_at timestamptz not null default now()
);
alter table public.creator_common_knowledge enable row level security;
grant all on public.creator_common_knowledge to service_role;
