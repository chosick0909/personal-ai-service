create extension if not exists pgcrypto;
create extension if not exists vector;

do $$
begin
  create type public.reference_status as enum ('draft', 'processed', 'failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.script_version_type as enum ('ai_generation', 'feedback_apply', 'manual_save');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.script_status as enum ('draft', 'active', 'archived', 'failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.memory_type as enum ('preference', 'pattern', 'success');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.account_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  tone text,
  persona text,
  target_audience text,
  goal text,
  strategy text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.global_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  source text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.global_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.global_knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  type text not null default 'global_knowledge',
  category text not null,
  tone text,
  score numeric(5,2) not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint global_knowledge_chunks_document_id_chunk_index_key unique (document_id, chunk_index),
  constraint global_knowledge_chunks_score_range check (score >= 0 and score <= 100)
);

create table if not exists public.reference_analyses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null,
  source text,
  category text not null,
  tone text,
  summary text,
  structure_analysis text,
  hook_analysis text,
  psychology_analysis text,
  score numeric(5,2),
  status public.reference_status not null default 'processed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint reference_analyses_score_range check (score is null or (score >= 0 and score <= 100))
);

create table if not exists public.reference_analysis_chunks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  reference_analysis_id uuid not null references public.reference_analyses(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  type text not null default 'reference',
  category text not null,
  tone text,
  score numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint reference_analysis_chunks_reference_chunk_key unique (reference_analysis_id, chunk_index),
  constraint reference_analysis_chunks_score_range check (score is null or (score >= 0 and score <= 100))
);

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  title text not null,
  category text not null,
  tone text,
  current_content text not null default '',
  autosave_content text not null default '',
  status public.script_status not null default 'draft',
  current_score numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  last_autosaved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint scripts_current_score_range check (current_score is null or (current_score >= 0 and current_score <= 100))
);

create table if not exists public.script_versions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  script_id uuid not null references public.scripts(id) on delete cascade,
  version_number integer not null,
  version_type public.script_version_type not null,
  title text not null,
  content text not null,
  category text not null,
  tone text,
  score numeric(5,2),
  status public.script_status not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint script_versions_script_id_version_number_key unique (script_id, version_number),
  constraint script_versions_score_range check (score is null or (score >= 0 and score <= 100))
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  script_id uuid references public.scripts(id) on delete set null,
  script_version_id uuid references public.script_versions(id) on delete set null,
  type text not null default 'feedback',
  category text,
  tone text,
  score numeric(5,2),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint feedback_score_range check (score is null or (score >= 0 and score <= 100))
);

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  type public.memory_type not null,
  content text not null,
  category text,
  tone text,
  weight numeric(5,2) not null default 50,
  source_score numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint memories_weight_range check (weight >= 0 and weight <= 100),
  constraint memories_source_score_range check (source_score is null or (source_score >= 0 and source_score <= 100))
);

create table if not exists public.request_patterns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  pattern_key text not null,
  canonical_query text not null,
  category text,
  occurrence_count integer not null default 1,
  last_score numeric(5,2),
  metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint request_patterns_occurrence_positive check (occurrence_count > 0),
  constraint request_patterns_last_score_range check (last_score is null or (last_score >= 0 and last_score <= 100)),
  constraint request_patterns_account_pattern_key_key unique (account_id, pattern_key)
);

create index if not exists account_profiles_tone_idx
  on public.account_profiles (tone);

create index if not exists global_knowledge_documents_category_idx
  on public.global_knowledge_documents (category);

create index if not exists global_knowledge_chunks_document_id_idx
  on public.global_knowledge_chunks (document_id);

create index if not exists global_knowledge_chunks_category_created_at_idx
  on public.global_knowledge_chunks (category, created_at desc);

create index if not exists reference_analyses_account_category_created_at_idx
  on public.reference_analyses (account_id, category, created_at desc);

create index if not exists reference_analysis_chunks_account_category_created_at_idx
  on public.reference_analysis_chunks (account_id, category, created_at desc);

create index if not exists reference_analysis_chunks_reference_analysis_id_idx
  on public.reference_analysis_chunks (reference_analysis_id);

create index if not exists scripts_account_category_updated_at_idx
  on public.scripts (account_id, category, updated_at desc);

create index if not exists script_versions_account_category_created_at_idx
  on public.script_versions (account_id, category, created_at desc);

create index if not exists script_versions_script_id_created_at_idx
  on public.script_versions (script_id, created_at desc);

create index if not exists feedback_account_created_at_idx
  on public.feedback (account_id, created_at desc);

create index if not exists memories_account_type_weight_created_at_idx
  on public.memories (account_id, type, weight desc, created_at desc);

create index if not exists request_patterns_account_occurrence_idx
  on public.request_patterns (account_id, occurrence_count desc, last_seen_at desc);

create trigger set_accounts_updated_at
before update on public.accounts
for each row
execute function public.set_updated_at();

create trigger set_account_profiles_updated_at
before update on public.account_profiles
for each row
execute function public.set_updated_at();

create trigger set_global_knowledge_documents_updated_at
before update on public.global_knowledge_documents
for each row
execute function public.set_updated_at();

create trigger set_global_knowledge_chunks_updated_at
before update on public.global_knowledge_chunks
for each row
execute function public.set_updated_at();

create trigger set_reference_analyses_updated_at
before update on public.reference_analyses
for each row
execute function public.set_updated_at();

create trigger set_reference_analysis_chunks_updated_at
before update on public.reference_analysis_chunks
for each row
execute function public.set_updated_at();

create trigger set_scripts_updated_at
before update on public.scripts
for each row
execute function public.set_updated_at();

create trigger set_script_versions_updated_at
before update on public.script_versions
for each row
execute function public.set_updated_at();

create trigger set_feedback_updated_at
before update on public.feedback
for each row
execute function public.set_updated_at();

create trigger set_memories_updated_at
before update on public.memories
for each row
execute function public.set_updated_at();

create trigger set_request_patterns_updated_at
before update on public.request_patterns
for each row
execute function public.set_updated_at();

alter table public.accounts enable row level security;
alter table public.account_profiles enable row level security;
alter table public.global_knowledge_documents enable row level security;
alter table public.global_knowledge_chunks enable row level security;
alter table public.reference_analyses enable row level security;
alter table public.reference_analysis_chunks enable row level security;
alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;
alter table public.feedback enable row level security;
alter table public.memories enable row level security;
alter table public.request_patterns enable row level security;

create policy "Service role full access accounts"
on public.accounts
for all
to service_role
using (true)
with check (true);

create policy "Service role full access account_profiles"
on public.account_profiles
for all
to service_role
using (true)
with check (true);

create policy "Service role full access global_knowledge_documents"
on public.global_knowledge_documents
for all
to service_role
using (true)
with check (true);

create policy "Service role full access global_knowledge_chunks"
on public.global_knowledge_chunks
for all
to service_role
using (true)
with check (true);

create policy "Service role full access reference_analyses"
on public.reference_analyses
for all
to service_role
using (true)
with check (true);

create policy "Service role full access reference_analysis_chunks"
on public.reference_analysis_chunks
for all
to service_role
using (true)
with check (true);

create policy "Service role full access scripts"
on public.scripts
for all
to service_role
using (true)
with check (true);

create policy "Service role full access script_versions"
on public.script_versions
for all
to service_role
using (true)
with check (true);

create policy "Service role full access feedback"
on public.feedback
for all
to service_role
using (true)
with check (true);

create policy "Service role full access memories"
on public.memories
for all
to service_role
using (true)
with check (true);

create policy "Service role full access request_patterns"
on public.request_patterns
for all
to service_role
using (true)
with check (true);

create or replace function public.match_global_knowledge_context(
  p_category text,
  query_embedding vector(1536),
  match_count int default 2
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  category text,
  tone text,
  score numeric,
  created_at timestamptz,
  similarity double precision,
  final_rank double precision,
  metadata jsonb
)
language sql
stable
as $$
  with filtered as (
    select
      gkc.id,
      gkc.document_id,
      gkc.content,
      gkc.category,
      gkc.tone,
      gkc.score,
      gkc.created_at,
      gkc.metadata,
      gkc.embedding
    from public.global_knowledge_chunks gkc
    where gkc.embedding is not null
      and gkc.score >= 50
      and (p_category is null or gkc.category = p_category)
  )
  select
    filtered.id,
    filtered.document_id,
    filtered.content,
    filtered.category,
    filtered.tone,
    filtered.score,
    filtered.created_at,
    1 - (filtered.embedding <=> query_embedding) as similarity,
    (
      (1 - (filtered.embedding <=> query_embedding)) * 0.75
      + (least(filtered.score, 100) / 100.0) * 0.15
      + exp(-greatest(extract(epoch from timezone('utc', now()) - filtered.created_at), 0) / 2592000) * 0.10
    ) as final_rank,
    filtered.metadata
  from filtered
  order by final_rank desc, filtered.score desc, filtered.created_at desc
  limit least(greatest(match_count, 1), 5);
$$;

create or replace function public.match_account_context(
  p_account_id uuid,
  p_category text,
  query_embedding vector(1536),
  p_types text[] default array['reference','script','memory'],
  match_count int default 5,
  min_score numeric default 50
)
returns table (
  source_type text,
  source_id uuid,
  parent_id uuid,
  content text,
  category text,
  tone text,
  score numeric,
  created_at timestamptz,
  similarity double precision,
  final_rank double precision,
  metadata jsonb
)
language sql
stable
as $$
  with candidates as (
    select
      'reference'::text as source_type,
      rac.id as source_id,
      rac.reference_analysis_id as parent_id,
      rac.content,
      rac.category,
      rac.tone,
      coalesce(rac.score, 100)::numeric as score,
      rac.created_at,
      rac.metadata,
      rac.embedding
    from public.reference_analysis_chunks rac
    where rac.account_id = p_account_id
      and rac.embedding is not null
      and coalesce(rac.score, 100) >= min_score
      and (p_category is null or rac.category = p_category)

    union all

    select
      'script'::text as source_type,
      sv.id as source_id,
      sv.script_id as parent_id,
      sv.content,
      sv.category,
      sv.tone,
      coalesce(sv.score, 0)::numeric as score,
      sv.created_at,
      sv.metadata,
      sv.embedding
    from public.script_versions sv
    where sv.account_id = p_account_id
      and sv.embedding is not null
      and sv.status = 'active'
      and coalesce(sv.score, 0) >= min_score
      and (p_category is null or sv.category = p_category)

    union all

    select
      'memory'::text as source_type,
      m.id as source_id,
      null::uuid as parent_id,
      m.content,
      coalesce(m.category, p_category) as category,
      m.tone,
      greatest(coalesce(m.source_score, 0), m.weight)::numeric as score,
      m.created_at,
      m.metadata,
      m.embedding
    from public.memories m
    where m.account_id = p_account_id
      and m.embedding is not null
      and m.weight >= min_score
      and (p_category is null or m.category = p_category or m.category is null)
  )
  select
    candidates.source_type,
    candidates.source_id,
    candidates.parent_id,
    candidates.content,
    candidates.category,
    candidates.tone,
    candidates.score,
    candidates.created_at,
    1 - (candidates.embedding <=> query_embedding) as similarity,
    (
      (1 - (candidates.embedding <=> query_embedding)) * 0.65
      + (least(candidates.score, 100) / 100.0) * 0.25
      + exp(-greatest(extract(epoch from timezone('utc', now()) - candidates.created_at), 0) / 2592000) * 0.10
    ) as final_rank,
    candidates.metadata
  from candidates
  where candidates.source_type = any(p_types)
  order by final_rank desc, candidates.score desc, candidates.created_at desc
  limit least(greatest(match_count, 1), 5);
$$;
