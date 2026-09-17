begin;

create table public.creator_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('reference-accounts','trend-keywords','import-link','media-analyze','media-render')),
  request_key text not null,
  input_hash text not null,
  input jsonb not null default '{}',
  checkpoint jsonb not null default '{}',
  result jsonb,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  stage text not null default 'queued',
  error_code text,
  error_message text,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deadline_at timestamptz not null default now() + interval '30 minutes',
  usage_recorded boolean not null default false,
  unique(user_id,kind,request_key)
);
create index creator_jobs_recovery on public.creator_jobs(status,updated_at) where status in ('queued','running');
create index creator_jobs_user_history on public.creator_jobs(user_id,created_at desc);
alter table public.creator_jobs enable row level security;
grant select on public.creator_jobs to authenticated;
grant all on public.creator_jobs to service_role;
create policy creator_jobs_owner_read on public.creator_jobs for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.creator_request_aliases (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  request_key text not null,
  input_hash text not null,
  job_id uuid not null references public.creator_jobs(id) on delete cascade,
  primary key(user_id,kind,request_key)
);
alter table public.creator_request_aliases enable row level security;
grant all on public.creator_request_aliases to service_role;
create index creator_jobs_link_fingerprint on public.creator_jobs(user_id,account_id,input_hash) where kind='import-link';

create table public.creator_media_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  original_name text not null,
  mime_type text not null,
  declared_size bigint not null check (declared_size > 0 and declared_size <= 314572800),
  original_path text not null,
  preview_path text,
  output_path text,
  status text not null default 'uploading',
  duration_seconds numeric,
  manifest jsonb not null default '{"cuts":[],"subtitles":[]}',
  revision integer not null default 0,
  job_id uuid references public.creator_jobs(id) on delete set null,
  original_expires_at timestamptz not null default now() + interval '24 hours',
  output_expires_at timestamptz,
  original_deleted_at timestamptz,
  output_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, client_id)
);
create index creator_media_expiry on public.creator_media_projects(original_expires_at) where original_deleted_at is null;
create index creator_media_output_expiry on public.creator_media_projects(output_expires_at) where output_deleted_at is null;
alter table public.creator_media_projects enable row level security;
grant select on public.creator_media_projects to authenticated;
grant all on public.creator_media_projects to service_role;
create policy creator_media_owner_read on public.creator_media_projects for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.creator_media_artifacts (
  path text primary key,
  bucket text not null,
  project_id uuid references public.creator_media_projects(id) on delete set null,
  expires_at timestamptz not null
);
alter table public.creator_media_artifacts enable row level security;
grant all on public.creator_media_artifacts to service_role;
create index creator_media_artifacts_expiry on public.creator_media_artifacts(expires_at);

create table public.creator_reference_catalog (
  username text primary key check (username ~ '^[a-zA-Z0-9_.]{1,30}$'),
  profile jsonb not null,
  verified_at timestamptz not null,
  last_active_at timestamptz not null,
  professional boolean not null default false,
  active boolean not null default true
);
alter table public.creator_reference_catalog enable row level security;
grant all on public.creator_reference_catalog to service_role;
-- Catalog writes and verification are operator-only; clients receive curated API fields.

create table public.creator_account_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[a-zA-Z0-9_.]{1,30}$'),
  preference text not null check (preference in ('saved','excluded')),
  primary key(user_id,username)
);
alter table public.creator_account_preferences enable row level security;
grant select on public.creator_account_preferences to authenticated;
grant all on public.creator_account_preferences to service_role;
create policy creator_preferences_owner_read on public.creator_account_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.creator_provider_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  instagram_user_id text not null,
  encrypted_token text not null,
  expires_at timestamptz not null
);
alter table public.creator_provider_connections enable row level security;
grant all on public.creator_provider_connections to service_role;

create table public.creator_provider_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.creator_jobs(id) on delete set null,
  provider text not null,
  operation text not null,
  latency_ms integer not null,
  success boolean not null,
  usage jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index creator_provider_events_created on public.creator_provider_events(created_at);
alter table public.creator_provider_events enable row level security;
grant all on public.creator_provider_events to service_role;
grant usage,select on sequence public.creator_provider_events_id_seq to service_role;

alter table public.reference_videos
  add column if not exists source_url text,
  add column if not exists source_platform text,
  add column if not exists source_language text,
  add column if not exists translated_transcript text,
  add column if not exists provider_metadata jsonb;
alter table public.reference_videos drop constraint if exists reference_videos_source_mode_check;
alter table public.reference_videos add constraint reference_videos_source_mode_check
  check (source_mode in ('video','script_text','topic_only','link')) not valid;
alter table public.reference_videos validate constraint reference_videos_source_mode_check;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('creator-media','creator-media',false,314572800,
 array['video/mp4','video/quicktime','video/webm','application/zip','application/x-subrip','text/plain'])
on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('creator-exports','creator-exports',false,838860800,array['application/zip']) on conflict(id) do nothing;
-- Upload capability is signed per exact random path. No public storage policies.

-- Serialized creation also provides a transactional outbox when Redis is down.
create function public.creator_create_job(p_user uuid,p_account uuid,p_kind text,p_key text,p_hash text,p_input jsonb)
returns public.creator_jobs language plpgsql security invoker set search_path = '' as $$
declare j public.creator_jobs; a public.creator_request_aliases;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 9047));
  select * into a from public.creator_request_aliases where user_id=p_user and kind=p_kind and request_key=p_key;
  if found then
    if a.input_hash <> p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into j from public.creator_jobs where id=a.job_id;
    return j;
  end if;
  select * into j from public.creator_jobs where user_id=p_user and kind=p_kind and request_key=p_key;
  if found then
    if j.input_hash <> p_hash then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return j;
  end if;
  if p_kind='import-link' then
    select * into j from public.creator_jobs where user_id=p_user and account_id=p_account and kind=p_kind and input_hash=p_hash
      and status in ('queued','running','completed') order by created_at desc limit 1;
    if found then
      insert into public.creator_request_aliases values(p_user,p_kind,p_key,p_hash,j.id);
      return j;
    end if;
  end if;
  if (select count(*) from public.creator_jobs where user_id=p_user and created_at>now()-interval '24 hours') >= 40
    then raise exception 'DAILY_JOB_LIMIT'; end if;
  if (select count(*) from public.creator_jobs where user_id=p_user and status in ('queued','running')) >= 3
    then raise exception 'ACTIVE_JOB_LIMIT'; end if;
  if p_kind='import-link' and (p_input->>'monthlyReferenceLimit') is not null then
    if (select count(*) from public.usage_events where user_id=p_user and event_type='reference_analysis'
        and entitlement_id=(p_input->>'entitlementId')::uuid
        and created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')
      + (select count(*) from public.creator_jobs where user_id=p_user and kind=p_kind and status in ('queued','running')
        and input->>'entitlementId'=p_input->>'entitlementId') >= (p_input->>'monthlyReferenceLimit')::integer
      then raise exception 'MONTHLY_REFERENCE_LIMIT'; end if;
  end if;
  if p_account is not null and not exists(select 1 from public.accounts where id=p_account and owner_user_id=p_user)
    then raise exception 'ACCOUNT_NOT_OWNED'; end if;
  insert into public.creator_jobs(user_id,account_id,kind,request_key,input_hash,input)
    values(p_user,p_account,p_kind,p_key,p_hash,p_input) returning * into j;
  insert into public.creator_request_aliases values(p_user,p_kind,p_key,p_hash,j.id);
  return j;
end $$;
revoke all on function public.creator_create_job(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.creator_create_job(uuid,uuid,text,text,text,jsonb) to service_role;

-- Usage and completion commit atomically, so a retried worker cannot double-charge.
create function public.creator_complete_job(p_id uuid,p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare j public.creator_jobs;
begin
  select * into j from public.creator_jobs where id=p_id for update;
  if not found or j.status in ('completed','cancelled','failed') then return; end if;
  if j.kind='import-link' and not j.usage_recorded then
    insert into public.usage_events(user_id,entitlement_id,reference_id,event_type)
    values(j.user_id,(j.input->>'entitlementId')::uuid,(p_result->>'referenceId')::uuid,'reference_analysis');
  end if;
  update public.creator_jobs set status='completed',stage='completed',result=p_result,
    error_code=null,error_message=null,usage_recorded=(kind='import-link'),updated_at=now(),checkpoint='{}' where id=p_id;
end $$;
revoke all on function public.creator_complete_job(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.creator_complete_job(uuid,jsonb) to service_role;
create function public.creator_create_media(p_id uuid,p_user uuid,p_client text,p_name text,p_mime text,p_size bigint,p_path text)
returns public.creator_media_projects language plpgsql security invoker set search_path = '' as $$
declare m public.creator_media_projects;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,9047));
  select * into m from public.creator_media_projects where user_id=p_user and client_id=p_client;
  if found then
    if m.original_name <> p_name or m.declared_size <> p_size or m.mime_type <> p_mime then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return m;
  end if;
  if (select count(*) from public.creator_media_projects where user_id=p_user and created_at>now()-interval '24 hours') >= 10 then raise exception 'DAILY_JOB_LIMIT'; end if;
  insert into public.creator_media_projects(id,user_id,client_id,original_name,mime_type,declared_size,original_path)
    values(p_id,p_user,p_client,p_name,p_mime,p_size,p_path) returning * into m;
  insert into public.creator_media_artifacts(path,bucket,project_id,expires_at)
    values(p_path,'creator-media',m.id,m.original_expires_at);
  return m;
end $$;
revoke all on function public.creator_create_media(uuid,uuid,text,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.creator_create_media(uuid,uuid,text,text,text,bigint,text) to service_role;
commit;
