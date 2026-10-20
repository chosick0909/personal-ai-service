#!/bin/bash
set -euo pipefail
pgbin=/opt/homebrew/opt/postgresql@17/bin
cluster=$(mktemp -d /tmp/hookai-tool-history-pg.XXXXXX)
cleanup() { "$pgbin/pg_ctl" -D "$cluster/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$cluster"; }
trap cleanup EXIT
"$pgbin/initdb" -D "$cluster/data" -A trust --no-locale >/dev/null
"$pgbin/pg_ctl" -D "$cluster/data" -l "$cluster/server.log" -o "-k $cluster -p 55489 -c listen_addresses=''" -w start >/dev/null
"$pgbin/psql" -h "$cluster" -p 55489 -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create schema auth;
create table auth.users(id uuid primary key);
create table public.accounts(id uuid primary key);
create table public.projects(id uuid primary key);
create role anon;
create role authenticated;
create role service_role bypassrls;
SQL
"$pgbin/psql" -h "$cluster" -p 55489 -d postgres -v ON_ERROR_STOP=1 -f supabase/migrations/20261020060000_tool_history.sql
"$pgbin/psql" -h "$cluster" -p 55489 -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin
 if has_table_privilege('anon','public.tool_history','SELECT') then raise exception 'anon can read'; end if;
 if has_table_privilege('authenticated','public.tool_history','SELECT') then raise exception 'client can read'; end if;
 if not has_table_privilege('service_role','public.tool_history','INSERT') then raise exception 'service cannot write'; end if;
 if not (select relrowsecurity from pg_class where oid='public.tool_history'::regclass) then raise exception 'RLS disabled'; end if;
end $$;
insert into auth.users values('11111111-1111-4111-8111-111111111111');
insert into public.accounts values('11111111-1111-4111-8111-111111111111');
insert into public.tool_history(id,user_id,account_id,kind,title,input,result)
 values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','caption','test','{}','{}');
update public.tool_history set edited_caption='edit',version=2 where version=1;
do $$ declare changed integer; begin
 update public.tool_history set edited_caption='stale',version=2 where version=1;
 get diagnostics changed=row_count;
 if changed<>0 then raise exception 'stale version accepted'; end if;
end $$;
delete from public.accounts;
do $$ begin if exists(select 1 from public.tool_history) then raise exception 'account cascade failed'; end if; end $$;
SQL
