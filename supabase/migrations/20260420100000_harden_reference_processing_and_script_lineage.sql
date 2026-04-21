-- P1 hardening: processing lifecycle, idempotency metadata, script-reference lineage

alter table public.reference_videos
  add column if not exists current_stage text,
  add column if not exists failure_stage text,
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists analysis_fingerprint text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz;

create index if not exists reference_videos_account_status_created_idx
  on public.reference_videos (account_id, processing_status, created_at desc);

create index if not exists reference_videos_account_fingerprint_created_idx
  on public.reference_videos (account_id, analysis_fingerprint, created_at desc)
  where analysis_fingerprint is not null;

create index if not exists reference_videos_account_idempotency_created_idx
  on public.reference_videos (account_id, idempotency_key, created_at desc)
  where idempotency_key is not null;

alter table public.scripts
  add column if not exists reference_video_id uuid references public.reference_videos(id) on delete set null;

create index if not exists scripts_account_reference_video_created_idx
  on public.scripts (account_id, reference_video_id, created_at desc)
  where reference_video_id is not null;
