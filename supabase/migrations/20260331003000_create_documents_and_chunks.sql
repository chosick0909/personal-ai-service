create extension if not exists vector;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  constraint chunks_document_id_chunk_index_key unique (document_id, chunk_index)
);

create index if not exists documents_created_at_idx
  on public.documents (created_at desc);

create index if not exists chunks_document_id_idx
  on public.chunks (document_id);

create index if not exists chunks_created_at_idx
  on public.chunks (created_at desc);
