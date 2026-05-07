alter table public.reference_videos
  add column if not exists analysis_stage_metrics jsonb not null default '{}'::jsonb,
  add column if not exists transcript_quality jsonb not null default '{}'::jsonb;
