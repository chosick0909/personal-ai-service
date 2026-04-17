create or replace function public.match_legacy_account_chunks(
  p_account_id uuid,
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
  similarity double precision,
  final_rank double precision
)
language sql
stable
as $$
  with filtered as (
    select
      c.id,
      c.document_id,
      c.chunk_index,
      c.content,
      c.metadata,
      c.created_at,
      c.embedding,
      coalesce(nullif(c.metadata ->> 'score', '')::numeric, 100) as score
    from public.chunks c
    where c.account_id = p_account_id
      and c.embedding is not null
      and coalesce(nullif(c.metadata ->> 'score', '')::numeric, 100) >= 50
  )
  select
    filtered.id,
    filtered.document_id,
    filtered.chunk_index,
    filtered.content,
    filtered.metadata,
    filtered.created_at,
    1 - (filtered.embedding <=> query_embedding) as similarity,
    (
      (1 - (filtered.embedding <=> query_embedding)) * 0.8
      + (least(filtered.score, 100) / 100.0) * 0.1
      + exp(-greatest(extract(epoch from timezone('utc', now()) - filtered.created_at), 0) / 2592000) * 0.1
    ) as final_rank
  from filtered
  order by final_rank desc, filtered.created_at desc
  limit least(greatest(match_count, 1), 5);
$$;

comment on function public.match_chunks(vector, int) is
  'DEPRECATED legacy search without account isolation. Use match_legacy_account_chunks or the hybrid account/global retrieval functions.';
