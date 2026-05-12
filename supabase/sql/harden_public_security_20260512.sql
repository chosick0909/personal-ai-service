-- HookAI Supabase public schema hardening
-- Run this in Supabase Dashboard > SQL Editor.
--
-- Why:
-- - Supabase Advisor flagged "RLS Disabled in Public" on app data tables.
-- - The app reads/writes these tables through the backend service_role client.
-- - Therefore anon/authenticated direct table access should be closed.
--
-- Important:
-- - Do not use broad authenticated policies here unless the frontend truly needs
--   direct Data API table access.
-- - This script is intentionally idempotent for the listed tables/functions.

begin;

-- ---------------------------------------------------------------------------
-- 1) Enable RLS and remove direct anon/authenticated table access
-- ---------------------------------------------------------------------------
do $$
declare
  table_names text[] := array[
    'documents',
    'chunks',
    'session_memory',
    'reference_videos',
    'projects',
    'entitlement_limits',
    'usage_events',
    'caption_category_rules',
    'coupons',
    'user_entitlements',
    'memory_events'
  ];
  table_name text;
  table_ref regclass;
begin
  foreach table_name in array table_names loop
    table_ref := to_regclass(format('public.%I', table_name));

    if table_ref is null then
      raise notice 'Skipping missing table public.%', table_name;
      continue;
    end if;

    execute format('alter table %s enable row level security', table_ref);

    -- App data should go through backend service_role APIs, not direct browser
    -- REST access with anon/authenticated roles.
    execute format('revoke all privileges on table %s from anon', table_ref);
    execute format('revoke all privileges on table %s from authenticated', table_ref);

    -- Keep backend access explicit. service_role also has BYPASSRLS, but this
    -- documents the intended access model and avoids future confusion.
    execute format('grant all privileges on table %s to service_role', table_ref);

    execute format(
      'drop policy if exists %I on %s',
      'hookai_backend_service_role_full_access',
      table_ref
    );

    execute format(
      'create policy %I on %s for all to service_role using (true) with check (true)',
      'hookai_backend_service_role_full_access',
      table_ref
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Fix mutable search_path warnings on public functions
-- ---------------------------------------------------------------------------
do $$
declare
  function_signatures text[] := array[
    'public.legacy_default_account_id()',
    'public.match_legacy_account_chunks(uuid, vector, integer)',
    'public.match_chunks(vector, integer)',
    'public.match_global_knowledge_context(text, vector, integer)',
    'public.match_account_context(uuid, text, vector, text[], integer, numeric)',
    'public.set_updated_at()',
    'public.match_writing_playbook_rules(vector, text, text, text, integer, boolean)'
  ];
  function_signature text;
  function_ref regprocedure;
begin
  foreach function_signature in array function_signatures loop
    function_ref := to_regprocedure(function_signature);

    if function_ref is null then
      raise notice 'Skipping missing function %', function_signature;
      continue;
    end if;

    execute format(
      'alter function %s set search_path = public, pg_temp',
      function_ref
    );

    -- These RPC functions are called by the backend service_role client.
    -- Remove direct browser role execution unless a concrete frontend use-case
    -- is added later with RLS-safe policies.
    execute format('revoke all on function %s from public', function_ref);
    execute format('revoke all on function %s from anon', function_ref);
    execute format('revoke all on function %s from authenticated', function_ref);
    execute format('grant execute on function %s to service_role', function_ref);
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 3) Verification queries
-- Run these after the transaction above.
-- ---------------------------------------------------------------------------

-- 3-1) RLS must be true for all listed tables.
with target_tables(table_name) as (
  values
    ('documents'),
    ('chunks'),
    ('session_memory'),
    ('reference_videos'),
    ('projects'),
    ('entitlement_limits'),
    ('usage_events'),
    ('caption_category_rules'),
    ('coupons'),
    ('user_entitlements'),
    ('memory_events')
)
select
  target_tables.table_name,
  coalesce(c.relrowsecurity, false) as rls_enabled
from target_tables
left join pg_class c
  on c.relname = target_tables.table_name
left join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by target_tables.table_name;

-- 3-2) This should return 0 rows for anon/authenticated table privileges.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in (
    'documents',
    'chunks',
    'session_memory',
    'reference_videos',
    'projects',
    'entitlement_limits',
    'usage_events',
    'caption_category_rules',
    'coupons',
    'user_entitlements',
    'memory_events'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- 3-3) This should only show the service_role policy for the hardened tables,
-- unless we intentionally add narrower user-facing policies later.
select
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'documents',
    'chunks',
    'session_memory',
    'reference_videos',
    'projects',
    'entitlement_limits',
    'usage_events',
    'caption_category_rules',
    'coupons',
    'user_entitlements',
    'memory_events'
  )
order by tablename, policyname;

-- 3-4) Function search_path should be fixed to public, pg_temp.
select
  p.proname as function_name,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'legacy_default_account_id',
    'match_legacy_account_chunks',
    'match_chunks',
    'match_global_knowledge_context',
    'match_account_context',
    'set_updated_at',
    'match_writing_playbook_rules'
  )
order by p.proname;

-- ---------------------------------------------------------------------------
-- 4) Manual Dashboard action
-- ---------------------------------------------------------------------------
-- Supabase Dashboard > Auth > Security:
-- Enable "Leaked Password Protection".
--
-- The "Extension in Public: public.vector" advisor warning is lower priority.
-- Moving pgvector to an extensions schema can be done later, but it requires
-- a separate compatibility pass because existing functions/columns currently
-- use vector(1536).
