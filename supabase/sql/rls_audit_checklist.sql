-- RLS Audit Checklist (run in Supabase SQL Editor)
-- 목적:
-- 1) RLS가 모든 핵심 테이블에서 활성화됐는지 확인
-- 2) anon/authenticated 노출 정책이 있는지 탐지
-- 3) 멀티테넌트 분리 키(account_id, owner_user_id) 무결성 확인
-- 4) 함수/권한 노출 상태 점검

-- ---------------------------------------------------------------------------
-- 0) 점검 대상 핵심 테이블 목록
-- ---------------------------------------------------------------------------
with required_tables(table_name) as (
  values
    ('accounts'),
    ('account_profiles'),
    ('global_knowledge_documents'),
    ('global_knowledge_chunks'),
    ('reference_analyses'),
    ('reference_analysis_chunks'),
    ('scripts'),
    ('script_versions'),
    ('feedback'),
    ('memories'),
    ('request_patterns'),
    ('memory_events'),
    ('session_memory'),
    ('documents'),
    ('chunks'),
    ('reference_videos')
)
select *
from required_tables
order by table_name;

-- ---------------------------------------------------------------------------
-- 1) RLS 활성화/강제 여부
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'accounts','account_profiles','global_knowledge_documents','global_knowledge_chunks',
    'reference_analyses','reference_analysis_chunks','scripts','script_versions',
    'feedback','memories','request_patterns','memory_events','session_memory',
    'documents','chunks','reference_videos'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 2) 정책 목록 전체 확인
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 3) anon/authenticated 노출 정책 탐지
-- 운영 API가 backend(service_role) 경유라면, 아래 결과는 보통 0건이어야 안전
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and (
    roles::text ilike '%anon%'
    or roles::text ilike '%authenticated%'
    or roles::text ilike '%public%'
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 4) 핵심 분리 키 무결성 확인
-- ---------------------------------------------------------------------------
-- 4-1) owner_user_id 누락 계정
select count(*) as accounts_missing_owner_user_id
from public.accounts
where owner_user_id is null;

-- 4-2) account_id nullable 여부 (핵심 테이블)
select
  table_name,
  column_name,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name = 'account_id'
  and table_name in (
    'account_profiles','scripts','script_versions','feedback','memories',
    'request_patterns','memory_events','session_memory','documents','chunks',
    'reference_videos','reference_analyses','reference_analysis_chunks'
  )
order by table_name;

-- 4-3) account_id FK 존재 여부
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as referenced_table,
  ccu.column_name as referenced_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and kcu.column_name = 'account_id'
order by tc.table_name;

-- ---------------------------------------------------------------------------
-- 5) 함수 노출 점검 (RPC 경로 노출 가능성)
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('match_chunks', 'match_account_context', 'match_global_knowledge_context')
order by p.proname;

-- 함수 실행권한 확인
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('match_chunks', 'match_account_context', 'match_global_knowledge_context')
order by routine_name, grantee;

-- ---------------------------------------------------------------------------
-- 6) 정책 기대치 빠른 FAIL 체크 (결과가 0건이면 통과)
-- ---------------------------------------------------------------------------
-- 6-1) RLS 비활성 테이블 탐지
with required_tables(table_name) as (
  values
    ('accounts'),('account_profiles'),('global_knowledge_documents'),('global_knowledge_chunks'),
    ('reference_analyses'),('reference_analysis_chunks'),('scripts'),('script_versions'),
    ('feedback'),('memories'),('request_patterns'),('memory_events'),('session_memory'),
    ('documents'),('chunks'),('reference_videos')
)
select rt.table_name
from required_tables rt
left join pg_class c on c.relname = rt.table_name
left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where c.oid is null
   or c.relrowsecurity is not true;

-- 6-2) owner_user_id 누락 계정 존재 탐지
select id, slug, name
from public.accounts
where owner_user_id is null
limit 50;

-- ---------------------------------------------------------------------------
-- 7) 수동 검증 체크 (주석)
-- ---------------------------------------------------------------------------
-- [ ] Supabase Dashboard > Authenticated role에서 public 테이블 직접 조회가 필요한지 재확인
-- [ ] 필요 없다면 anon/authenticated 정책/권한 모두 제거
-- [ ] Backend만 service_role 사용, frontend는 anon key + auth 토큰만 사용
-- [ ] account_id를 body/header로 임의 주입해도 owner_user_id 검증으로 차단되는지 API 통합테스트 수행

