create table if not exists public.reference_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null,
  original_filename text not null,
  mime_type text,
  duration_seconds numeric,
  transcript text,
  transcript_segments jsonb not null default '[]'::jsonb,
  frame_timestamps jsonb not null default '[]'::jsonb,
  frame_notes jsonb not null default '[]'::jsonb,
  structure_analysis text,
  hook_analysis text,
  psychology_analysis text,
  variations jsonb not null default '[]'::jsonb,
  ai_feedback text,
  processing_status text not null default 'completed',
  error_message text,
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists reference_videos_created_at_idx
  on public.reference_videos (created_at desc);
