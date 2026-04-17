create or replace function public.match_chunks (
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index integer,
  content text,
  metadata jsonb,
  created_at timestamptz,
  similarity float
)
language sql
stable
as $$
  select
    chunks.id,
    chunks.document_id,
    chunks.chunk_index,
    chunks.content,
    chunks.metadata,
    chunks.created_at,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from public.chunks
  where chunks.embedding is not null
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;
