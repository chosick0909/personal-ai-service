create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.narrative_patterns (
  id uuid primary key default gen_random_uuid(),
  narrative_code text not null unique,
  title text not null,
  narrative_family text not null,
  reference_formats text[] not null default '{}',
  emotional_arc text not null default '',
  structure_steps jsonb not null default '[]'::jsonb,
  use_when text[] not null default '{}',
  avoid_when text[] not null default '{}',
  body_flow_rule text not null default '',
  rewrite_rule text not null default '',
  risk_note text not null default '',
  use_intensity text not null default 'low',
  search_text text not null default '',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists narrative_patterns_family_active_idx
  on public.narrative_patterns (narrative_family, is_active);

create index if not exists narrative_patterns_reference_formats_idx
  on public.narrative_patterns using gin (reference_formats);

create index if not exists narrative_patterns_use_when_idx
  on public.narrative_patterns using gin (use_when);

create index if not exists narrative_patterns_avoid_when_idx
  on public.narrative_patterns using gin (avoid_when);

drop trigger if exists set_narrative_patterns_updated_at on public.narrative_patterns;
create trigger set_narrative_patterns_updated_at
before update on public.narrative_patterns
for each row
execute function public.set_updated_at();

alter table public.narrative_patterns enable row level security;

drop policy if exists "Service role can manage narrative patterns" on public.narrative_patterns;
create policy "Service role can manage narrative patterns"
on public.narrative_patterns
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create or replace function public.match_narrative_patterns(
  query_embedding vector(1536),
  match_count int default 2
)
returns table (
  id uuid,
  narrative_code text,
  title text,
  narrative_family text,
  reference_formats text[],
  emotional_arc text,
  use_when text[],
  avoid_when text[],
  body_flow_rule text,
  rewrite_rule text,
  risk_note text,
  use_intensity text,
  metadata jsonb,
  similarity double precision,
  final_rank double precision
)
language sql
stable
as $$
  select
    np.id,
    np.narrative_code,
    np.title,
    np.narrative_family,
    np.reference_formats,
    np.emotional_arc,
    np.use_when,
    np.avoid_when,
    np.body_flow_rule,
    np.rewrite_rule,
    np.risk_note,
    np.use_intensity,
    np.metadata,
    1 - (np.embedding <=> query_embedding) as similarity,
    1 - (np.embedding <=> query_embedding) as final_rank
  from public.narrative_patterns np
  where np.is_active = true
    and np.embedding is not null
  order by np.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 4);
$$;

with seed_data as (
  select * from jsonb_to_recordset($seed$
[
{"narrative_code":"NARRATIVE_01","title":"편견을 이긴 조력자 감사형 서사","narrative_family":"belief_support_transformation","reference_formats":["narrative","case_study"],"emotional_arc":"충격적 상태 → 세상의 편견 → 나를 믿어준 존재 → 가치 깨달음 → 감사","use_when":["개인 성장 서사","브랜드 탄생 스토리","멘토/가족/도구 덕분에 변화한 이야기","감성 브랜딩"],"avoid_when":["단순 정보형","튜토리얼","혜택 안내","가벼운 제품 추천"],"body_flow_rule":"과거의 불안정한 상태와 주변 편견을 보여준 뒤, 조력자나 핵심 계기가 전환점이 되었음을 강조한다.","rewrite_rule":"감정선을 살리되 과한 신파로 만들지 말고, 현재의 변화와 감사에 집중한다.","risk_note":"실제로 없는 가족, 조력자, 극적인 성공담을 만들지 않는다.","use_intensity":"medium_only_when_reference_is_emotional_story","search_text":"편견 조력자 믿어준 사람 가족 멘토 감사 성장 감동 브랜드 창업 과거 현재 변화"},
{"narrative_code":"NARRATIVE_02","title":"성공 뒤 실패 고백형 서사","narrative_family":"failure_confession_recovery","reference_formats":["narrative","case_study"],"emotional_arc":"실패 고백 → 좋았던 시절 회상 → 갑작스러운 상실 → 숨겨진 고통 → 위로","use_when":["사업 실패담","사기/손실 경험","멘탈 회복","공감형 콘텐츠","실패 극복"],"avoid_when":["가벼운 꿀팁","제품 기능 소개","할인/프로모션","짧은 튜토리얼"],"body_flow_rule":"처음부터 실패를 고백하고, 과거의 기대감과 무너진 순간을 대비시켜 공감과 위로로 마무리한다.","rewrite_rule":"실패를 자극적으로 소비하지 말고, 회복과 다시 시작하는 메시지를 중심으로 정리한다.","risk_note":"실제로 없는 사기, 금전 손실, 사업 실패를 생성하지 않는다.","use_intensity":"medium","search_text":"실패 고백 사업 실패 사기 당함 무너짐 밑바닥 자책 위로 다시 시작 포기하지 마"},
{"narrative_code":"NARRATIVE_03","title":"노력 무너짐 억울함 폭발형 서사","narrative_family":"frustration_breakdown","reference_formats":["narrative","vlog"],"emotional_arc":"사건 발생 → 반복된 문제 → 억울함/서러움 → 버티는 나","use_when":["작업 실패","창작자 브이로그","노력했는데 결과가 무너진 상황","현실 공감 콘텐츠"],"avoid_when":["전문 정보 전달","상품 판매","성공 사례","정돈된 튜토리얼"],"body_flow_rule":"구체적인 사건으로 시작해, 반복된 문제와 억울함을 감정적으로 보여준다.","rewrite_rule":"과한 신파보다 현실적인 억울함과 버티는 모습을 짧게 잡는다.","risk_note":"감정 과잉, 피해자 서사 과잉, 불필요한 이모지 남발을 피한다.","use_intensity":"low_to_medium","search_text":"노력했는데 날아감 저장 안됨 억울함 서러움 작업 실패 포기할까 봐 참는 브이로그"},
{"narrative_code":"NARRATIVE_04","title":"전문가 하루 루틴 브이로그형","narrative_family":"expert_daily_vlog","reference_formats":["vlog","educational"],"emotional_arc":"전문성 소개 → 하루 루틴 → 인간적 철학 → 작업 과정 → 지속성/감사","use_when":["전문가 브이로그","작업 과정 공개","브랜드 신뢰 형성","루틴 콘텐츠"],"avoid_when":["강한 세일즈","짧은 혜택 안내","자극적 이슈 콘텐츠"],"body_flow_rule":"전문가의 하루를 따라가며 루틴 속에서 신뢰, 정성, 반복성을 보여준다.","rewrite_rule":"허세보다 작업 디테일과 꾸준함을 중심으로 구성한다.","risk_note":"허위 경력, 허위 기간, 허위 전문성을 만들지 않는다.","use_intensity":"medium_when_reference_is_vlog","search_text":"전문가 브이로그 하루 루틴 작업 과정 연구 매일 분석 과정 공개 정성 전문성"},
{"narrative_code":"NARRATIVE_05","title":"사소한 문제에서 근본 해결 선언형","narrative_family":"small_symptom_to_root_change","reference_formats":["narrative","educational"],"emotional_arc":"사소한 문제 → 심각성 인지 → 무력감 → 임시 해결 실패 → 근본 변화 선언","use_when":["건강 습관","번아웃","생활 루틴 개선","피부/운동/자기관리"],"avoid_when":["단순 제품 추천","빠른 꿀팁","근거 없는 의학 주장"],"body_flow_rule":"사소해 보였던 문제가 반복되며 커지고, 임시방편 대신 근본 변화로 넘어가는 흐름이다.","rewrite_rule":"질병처럼 단정하지 말고 생활 습관이나 관리 방식 변화 중심으로 표현한다.","risk_note":"의학적 진단, 치료 효과, 건강 개선 보장을 임의 생성하지 않는다.","use_intensity":"medium","search_text":"사소한 증상 시작 심각해짐 번아웃 무기력 도돌이표 근본 해결 생활습관 바꾸기"},
{"narrative_code":"NARRATIVE_06","title":"큰 손실 후 실행 전환형","narrative_family":"loss_to_action","reference_formats":["narrative","vlog","case_study"],"emotional_arc":"큰 손실 위기 → 망가진 현실 → 실패 인정 → 그래서? → 작은 실행","use_when":["창업 도전기","리모델링","사업 위기","프로젝트 실패 후 재시작","비포애프터"],"avoid_when":["정보형 튜토리얼","혜택 안내","가벼운 리뷰"],"body_flow_rule":"큰 손실을 먼저 보여주고, 망한 현실을 인정한 뒤 작은 실행으로 분위기를 전환한다.","rewrite_rule":"위기를 과장하기보다 실제 행동으로 전환되는 지점을 선명하게 만든다.","risk_note":"실제 없는 손실 금액, 계약 실패, 사기 피해를 만들지 않는다.","use_intensity":"medium","search_text":"손실 실패 망가진 현실 그래서 주저앉을 수 없음 실행 시작 창업 리모델링 카페 상가 도전기"},
{"narrative_code":"NARRATIVE_07","title":"긴 시간 대비 짧은 반전 성과형","narrative_family":"long_struggle_fast_result","reference_formats":["narrative","promotion","case_study"],"emotional_arc":"긴 정체 → 짧은 기간 성과 → 통념 인용 → 솔직한 이유 → 주변 반응 → 다음 편 예고","use_when":["성장 후기","수익화 사례","퇴사/창업 스토리","도전기"],"avoid_when":["수익 근거 없는 콘텐츠","과장 광고","정보형 레퍼런스"],"body_flow_rule":"오랫동안 정체되던 사람이 짧은 기간 안에 결과를 낸 대비를 만들고, 솔직한 이유와 다음 편 궁금증으로 끌고 간다.","rewrite_rule":"성과보다 전환 동기와 긴장감을 중심으로 표현한다.","risk_note":"월수익, 매출, 투자 성과 등은 근거 없으면 생성 금지.","use_intensity":"low_to_medium","search_text":"오랜 기간 짧은 기간 결과 퇴사 수익화 필사적 주변 반응 모두 말림 다음 편"},
{"narrative_code":"NARRATIVE_08","title":"무심한 평가를 성장 정체성으로 바꾸는 서사","narrative_family":"criticism_to_identity","reference_formats":["narrative","educational"],"emotional_arc":"무심한 평가 → 지지자의 한마디 → 태도 변화 → 새로운 정체성 선언","use_when":["자기계발","운동","멘탈","습관 형성","커뮤니티 공감"],"avoid_when":["제품 판매 중심","짧은 기능 설명","가격/혜택 안내"],"body_flow_rule":"남의 평가를 지지자의 말로 재해석하고, 그 말을 통해 새로운 정체성을 만든다.","rewrite_rule":"비난을 억지 감동으로 바꾸지 말고, 행동의 의미를 새로 정의하는 데 집중한다.","risk_note":"실제 없는 인물 발언을 구체 인용처럼 만들지 않는다.","use_intensity":"medium","search_text":"무심한 평가 돈 버리러 가냐 지지 한마디 운동 삶 사치 아님 정체성 성장 멘탈"},
{"narrative_code":"NARRATIVE_09","title":"현타 후 과거 방식 결별형","narrative_family":"self_assessment_breakaway","reference_formats":["narrative","vlog"],"emotional_arc":"현재 상태 냉정 평가 → 노력 나열 → 억울함/현타 → 과거 방식 결별 → 미래 예고","use_when":["다이어트","공부법","운동법","루틴 전환","개인 프로젝트 도전기"],"avoid_when":["단순 정보형","즉시 꿀팁","제품 리뷰"],"body_flow_rule":"노력했지만 결과가 없던 상황을 보여주고, 기존 방식을 버리는 결단으로 전환한다.","rewrite_rule":"억울함을 통해 변화를 설득하되, 무리한 극단 행동은 순화한다.","risk_note":"건강 관련 극단 표현이나 무리한 방법 권장은 피한다.","use_intensity":"medium","search_text":"현타 노력했는데 결과 없음 식단 운동 억울함 기존 방식 결별 과학적으로 바꾸기"},
{"narrative_code":"NARRATIVE_10","title":"오해 유도 후 의미 반전형","narrative_family":"misdirection_wordplay","reference_formats":["narrative","promotion"],"emotional_arc":"오해 살 표현 → 부정적 뉘앙스 강화 → 리얼리티 추가 → 단어 의미 반전","use_when":["반전형 숏폼","가벼운 스토리","댓글 유도","브랜드 위트"],"avoid_when":["민감한 관계 이슈","진지한 실패담","공공정보/지원금 안내"],"body_flow_rule":"시청자가 오해하게 만든 뒤 마지막에 단어의 다른 의미를 공개해 반전을 만든다.","rewrite_rule":"낚시가 과하지 않게, 반전 후에는 긍정적 의미로 빠르게 회수한다.","risk_note":"불륜, 범죄, 질병 등 민감 소재는 브랜드 톤에 따라 피한다.","use_intensity":"low","search_text":"오해 반전 단어장난 낚시형 후킹 의미 반전 바람 공부바람"},
{"narrative_code":"NARRATIVE_11","title":"소문과 증거로 긴장감 만드는 폭로형","narrative_family":"rumor_evidence_escalation","reference_formats":["narrative","case_study","educational"],"emotional_arc":"수군거림 → 충격적 증거 → 대세감/반응 → 더 큰 사건 예고","use_when":["비용 폭로","업계 문제 제기","소비자 주의","시장 분석"],"avoid_when":["근거 없는 비방","특정 업체 공격","가벼운 추천 콘텐츠"],"body_flow_rule":"소문으로 긴장감을 만들고, 수치/증거를 제시한 뒤 더 큰 사건을 예고한다.","rewrite_rule":"폭로처럼 보이더라도 사실 확인 가능한 정보 중심으로 쓴다.","risk_note":"명예훼손, 허위 사실, 특정 업체 비방 주의.","use_intensity":"low_to_medium","search_text":"소문 단톡방 조심해라 견적서 비용 실화 폭로 조회수 업계 반응 더 무서운 사실"},
{"narrative_code":"NARRATIVE_12","title":"불안한 호출 후 따뜻한 반전형","narrative_family":"anxiety_to_warm_reward","reference_formats":["narrative","vlog"],"emotional_arc":"갑작스러운 호출 → 불안 심리 → 긴장의 절정 → 따뜻한 보상/격려","use_when":["직장 이야기","관계 서사","고객/팀원 감동 사례","브랜드 내부 문화"],"avoid_when":["정보 전달","튜토리얼","세일즈 중심"],"body_flow_rule":"나쁜 일이 생길 것 같은 긴장을 만들고, 마지막에 따뜻한 격려나 보상으로 뒤집는다.","rewrite_rule":"불안 묘사는 짧게, 반전은 구체적인 행동이나 한마디로 표현한다.","risk_note":"실제 없는 상사/고객 발언을 사실처럼 만들지 않는다.","use_intensity":"medium","search_text":"갑자기 연락 혼자 오라고 불안 심장 뛰는 회의실 반전 격려 보너스 따뜻한 한마디"},
{"narrative_code":"NARRATIVE_13","title":"위기에서 직접 만든 솔루션 창업형","narrative_family":"crisis_to_product_creation","reference_formats":["narrative","case_study","promotion"],"emotional_arc":"소중한 대상의 위기 → 시장 문제 자각 → 직접 해결 여정 → 데이터/결과 확신 → 가치 제안","use_when":["창업 스토리","제품 개발 비하인드","브랜드 철학","반려동물/육아/건강 관련 제품"],"avoid_when":["근거 없는 효능 주장","단순 할인 판매","가벼운 후기"],"body_flow_rule":"소중한 대상을 지키기 위한 위기에서 출발해, 직접 해결하고 검증한 결과물로 연결한다.","rewrite_rule":"제품 탄생 이유와 집요한 검증 과정을 중심으로 쓰되 효능 보장은 피한다.","risk_note":"건강, 반려동물, 식품 관련 효능 수치와 검사 결과는 실제 근거 없으면 금지.","use_intensity":"medium","search_text":"위기 직접 만들자 제품 개발 원재료 검증 브랜드 철학 진심 선물"},
{"narrative_code":"NARRATIVE_14","title":"과거 결핍과 현재 성취 증명형","narrative_family":"past_pain_to_authority","reference_formats":["narrative","case_study","educational","promotion"],"emotional_arc":"과거의 힘든 상태 → 현재의 압도적 성취 → 노하우 제시 → 타인의 성과 → 무료 가치 제안","use_when":["전문가 브랜딩","강의/컨설팅","건강/자기계발 사례","무료 자료 유도"],"avoid_when":["근거 없는 성과","의학적 치료 주장","순수 정보형"],"body_flow_rule":"과거의 결핍에서 현재의 성취로 대비를 만들고, 노하우와 타인 사례로 신뢰를 강화한다.","rewrite_rule":"성과를 나열하기보다 변화 과정과 제공할 가치를 명확히 한다.","risk_note":"고객 성과, 감량, 건강 개선, 약 중단 등은 실제 근거 없으면 생성 금지.","use_intensity":"low_to_medium","search_text":"과거 문제 현재 성취 전문가 노하우 수강생 성과 무료 방법 건강 자기계발 컨설팅"},
{"narrative_code":"NARRATIVE_15","title":"비난을 땔감으로 바꾸는 도전형","narrative_family":"criticism_as_fuel","reference_formats":["narrative","educational"],"emotional_arc":"차가운 말 → 상처받은 기억 → 분노의 전환 → 부정적 자극 재해석 → 함께 도약","use_when":["자기계발","도전 응원","퇴사/창업","동기부여 콘텐츠"],"avoid_when":["상품 기능 설명","중립적 정보 전달","공공 안내"],"body_flow_rule":"상처가 된 말을 다시 떠올리고, 그 말을 포기하지 않는 에너지로 재정의한다.","rewrite_rule":"비난을 미화하지 말고 나의 행동 동력으로 바꾸는 메시지를 만든다.","risk_note":"특정인을 공격하거나 조롱하는 방향으로 쓰지 않는다.","use_intensity":"medium","search_text":"네가 어떻게 해 비난 무시하는 말 땔감 보란듯이 해내기 포기하고 싶을 때 도전 응원"},
{"narrative_code":"NARRATIVE_16","title":"과거 결핍에서 빠른 성취로 반전형","narrative_family":"past_self_to_teachable_success","reference_formats":["narrative","educational","case_study"],"emotional_arc":"과거 선택 질문 → 부족했던 과거 → 짧은 기간 성과 → 타인 성과 → 본질 통찰 → 함께 반전 제안","use_when":["교육","강의","언어/공부법","자기계발","멘토 브랜딩"],"avoid_when":["검증 안 된 성과","단순 제품 판매","가벼운 리뷰"],"body_flow_rule":"과거의 나와 비슷한 사람에게, 짧은 성과와 본질적 방법을 제시해 함께 변화하자고 말한다.","rewrite_rule":"과거 결핍과 현재 노하우를 연결하되, 성과 수치는 실제 근거가 있을 때만 쓴다.","risk_note":"수강생 성과, 합격, 기간 내 변화는 허위 생성 금지.","use_intensity":"medium","search_text":"몇 년 전으로 돌아간다면 과거 부족 짧은 기간 목표 달성 수강생 성과 본질 통찰"},
{"narrative_code":"NARRATIVE_17","title":"지금 시작하지 않으면 후회형","narrative_family":"future_regret_education_offer","reference_formats":["educational","promotion","narrative"],"emotional_arc":"과거 선택 질문 → 과거 방식과 현재 도구 대비 → 성과 증명 → 미래 후회 경고 → 무료 자료 보상","use_when":["AI툴","투자 공부","교육 자료","로드맵 제공","시간 절약 콘텐츠"],"avoid_when":["근거 없는 수익/투자 성과","감성 스토리","제품 단순 리뷰"],"body_flow_rule":"과거에는 어려웠지만 지금은 도구로 빨라졌다는 대비를 만들고, 늦게 시작하면 후회한다는 메시지로 행동을 유도한다.","rewrite_rule":"후회 자극은 쓰되 불안 조장보다 지금 시작할 이유와 자료 보상에 집중한다.","risk_note":"투자 수익, 자산 증가 등 금융 성과는 근거 없으면 금지.","use_intensity":"low_to_medium","search_text":"몇 년 전 돌아간다면 AI 활용 더 빨리 목표 달성 후회할 거예요 무료 자료 로드맵 투자 공부"},
{"narrative_code":"NARRATIVE_18","title":"고객 사례 변화 증명형","narrative_family":"client_case_transformation","reference_formats":["case_study","narrative","promotion"],"emotional_arc":"힘든 고객 등장 → 간절한 목표 → 맞춤 솔루션과 단기 결과 → 장기 지속 → 삶의 변화 → 한정 제안","use_when":["코칭","컨설팅","강의","고객 성공 사례","프로그램 판매"],"avoid_when":["실제 고객 사례 없음","공공 정보","가벼운 꿀팁"],"body_flow_rule":"고객의 문제와 목표를 보여주고, 맞춤 솔루션을 통해 단기·장기 변화를 증명한다.","rewrite_rule":"고객 사례가 실제일 때만 사용하고, 결과보다 변화 과정을 중심으로 표현한다.","risk_note":"허위 고객, 수강생 성과, 합격, 건강 개선 사례 생성 금지.","use_intensity":"medium_only_with_real_case","search_text":"고객 사례 수강생 변화 맞춤 솔루션 단기 결과 장기 지속 가족 행복 한정 초대권 프로그램"},
{"narrative_code":"NARRATIVE_19","title":"비밀 치트키와 비포애프터형","narrative_family":"secret_cheatkey_before_after","reference_formats":["promotion","review","educational"],"emotional_arc":"비밀 공개 → 비포애프터 증명 → 댓글 참여 제안 → 더 큰 비밀 예고","use_when":["공간/인테리어","뷰티","청소","자료 배포","댓글 유도형 콘텐츠"],"avoid_when":["서사형 감동 콘텐츠","근거 없는 효과","민감 건강 분야"],"body_flow_rule":"나만 아는 치트키처럼 열고, 전후 대비로 증명한 뒤 댓글 참여로 전환한다.","rewrite_rule":"비밀스럽게 포장하되 실제 제공 가능한 자료나 결과물과 연결한다.","risk_note":"비포애프터 효과가 실제 근거 없으면 과장하지 않는다.","use_intensity":"low_to_medium","search_text":"비밀 치트키 공개 비포 애프터 댓글 키워드 가이드북 보내드릴게요 공간 변화"},
{"narrative_code":"NARRATIVE_20","title":"숨기고 싶던 과거를 발판으로 바꾸는 서사","narrative_family":"shame_to_resilience","reference_formats":["narrative"],"emotional_arc":"숨기고 싶은 과거 → 세상의 비난 → 태도 반전 → 현재 증명 → 위로","use_when":["학벌/경력 콤플렉스 극복","인생 도전기","자기계발","브랜딩 스토리"],"avoid_when":["단순 정보","제품 판매","가벼운 리뷰"],"body_flow_rule":"숨기고 싶던 과거를 정면으로 꺼내고, 그것을 현재를 만든 발판으로 재정의한다.","rewrite_rule":"자기연민보다 회복력과 현재의 태도를 중심으로 쓴다.","risk_note":"학력, 가난, 실패 같은 민감한 요소를 자극적으로 소비하지 않는다.","use_intensity":"medium","search_text":"숨기고 싶은 과거 학벌 콤플렉스 실패 발판 그게 뭐 현재 증명 버텨낼 수 있다"},
{"narrative_code":"NARRATIVE_21","title":"가족의 소망과 초라한 현실에서 시작하는 서사","narrative_family":"family_wish_hidden_poverty","reference_formats":["narrative","vlog"],"emotional_arc":"주변인의 소망 → 감춘 결핍 → 노력 과정 → 낯선 반전 → 다음 궁금증","use_when":["가족 서사","부업 도전","생활형 브이로그","다음 편 유도"],"avoid_when":["정보형","제품 판매","지원금 안내"],"body_flow_rule":"가족이나 주변인의 소박한 바람을 계기로 숨겨둔 결핍과 노력을 보여준다.","rewrite_rule":"초라한 현실을 과장하지 말고 작게 시작한 행동과 다음 사건의 궁금증을 살린다.","risk_note":"가족 사정, 가난, 금전 결핍을 허위로 만들지 않는다.","use_intensity":"medium","search_text":"가족 소망 통장 잔고 부족 부업 노력 묘한 동네 글쎄 다음편"},
{"narrative_code":"NARRATIVE_22","title":"망한 도전에서 얻은 현실 통찰형","narrative_family":"failed_launch_business_lesson","reference_formats":["narrative","case_study","educational"],"emotional_arc":"당당한 실패 선언 → 기존 성과로 신뢰 → 실패 이유 분석 → 통찰 → 유쾌한 팔로우","use_when":["사업 운영","제품 출시 실패","마케팅 회고","창업자 콘텐츠","실패에서 배우는 콘텐츠"],"avoid_when":["성공만 강조하는 광고","단순 제품 소개","근거 없는 매출 주장"],"body_flow_rule":"실패를 숨기지 않고 열어 신뢰를 만들고, 왜 안 됐는지 현실적인 분석으로 이어간다.","rewrite_rule":"실패를 유쾌하게 인정하되, 배운 점이 남도록 정리한다.","risk_note":"매출, 원가, 판매 성과 등은 실제 근거 없으면 생성 금지.","use_intensity":"medium","search_text":"망했어요 출시 실패 매출 자랑 폭망 원가 비쌈 왜 안됐을까요 운영 뒷이야기"},
{"narrative_code":"NARRATIVE_23","title":"자기소개와 정체성 탐색형","narrative_family":"identity_intro_origin","reference_formats":["narrative","vlog"],"emotional_arc":"나를 나타내는 숫자/키워드 → 일반 코스와 다른 이력 → 현재 활동 → 정체성 고민 → 계정 시작 선언","use_when":["첫 게시물","브랜드/개인 소개","창작자 계정 시작","페르소나 구축"],"avoid_when":["정보 전달","세일즈","단발성 꿀팁"],"body_flow_rule":"자신의 이력과 현재 활동을 보여주며, 아직 정의 중인 정체성을 계정 시작 이유로 연결한다.","rewrite_rule":"거창한 성공담보다 ‘나는 어떤 사람인가’를 자연스럽게 보여준다.","risk_note":"나이, 학력, 경력 등 민감한 정보는 사용자 입력이 있을 때만 사용한다.","use_intensity":"medium","search_text":"자기소개 몇 년생 일반 코스와 다른 선택 현재 활동 정체성 고민 이 계정 시작"},
{"narrative_code":"NARRATIVE_24","title":"무모한 공간/사업 도전과 공동체 완성형","narrative_family":"ambitious_project_community_support","reference_formats":["narrative","vlog","case_study"],"emotional_arc":"무모한 목표 → 지옥 같은 고난 → 조력자 등장 → 비즈니스 본질 깨달음 → 함께 지켜봐 달라","use_when":["공간 리모델링","카페 창업","브랜드 탄생기","프로젝트 도전기","공동체 서사"],"avoid_when":["정보형","짧은 리뷰","단순 제품 판매"],"body_flow_rule":"무모한 욕심이 고난이 되는 과정을 보여주고, 조력자와 함께 완성하며 일의 본질을 재정의한다.","rewrite_rule":"고난의 디테일과 조력자의 역할을 균형 있게 보여준다.","risk_note":"응급실, 극단적 고생, 재산 손실 등은 실제 근거 없으면 만들지 않는다.","use_intensity":"medium","search_text":"폐가 카페 무모한 도전 고난 누수 폐기물 포기하고 싶을 때 사람들 도움 공간 가치 도전기"},
{"narrative_code":"NARRATIVE_25","title":"남들의 시선에서 나다운 길로 전환형","narrative_family":"social_judgment_authentic_path","reference_formats":["narrative","educational"],"emotional_arc":"남들의 우려 → 정체성 갈등 → 통찰/명언 → 모두를 만족시킬 수 없음 → 나만의 길 응원","use_when":["퇴사/전향","창작자 정체성","커리어 변화","자기계발"],"avoid_when":["제품 기능 소개","혜택 공지","튜토리얼"],"body_flow_rule":"주변 시선으로 생긴 정체성 갈등을 통찰로 풀고, 자기 길을 가는 메시지로 마무리한다.","rewrite_rule":"유명인의 명언은 실제 근거가 없으면 일반적 통찰로 바꾼다.","risk_note":"실제 인물의 발언을 허위 인용하지 않는다.","use_intensity":"medium","search_text":"남들의 시선 걱정 좋은 직장 왜 그만둬 정체성 안 어울린다 모두에게 사랑받으려 하지 마 나만의 길"},
{"narrative_code":"NARRATIVE_26","title":"안정 대신 무모한 도전 선택형","narrative_family":"reject_safe_path_bold_start","reference_formats":["narrative","case_study"],"emotional_arc":"안정적 선택 거부 → 기존 방식 의문 → 역발상 실행 → 주변 반응 → 사건 예고","use_when":["창업","퇴사","커리어 전환","역발상 도전기","브랜드 시작"],"avoid_when":["단순 정보형","제품 추천","혜택 안내"],"body_flow_rule":"안정적인 선택 대신 무모해 보이는 도전을 택한 이유를 현실적 의문과 가치 선택으로 설득한다.","rewrite_rule":"무모함을 미화하지 말고, 왜 그 선택이 필요했는지 논리와 감정을 함께 보여준다.","risk_note":"대기업/취업/창업 등 개인 선택을 무책임하게 부추기지 않는다.","use_intensity":"medium","search_text":"안정 대신 무모한 도전 대기업 대신 창업 남들과 똑같이 성공할 수 있을까 주변 반응"},
{"narrative_code":"NARRATIVE_27","title":"주변 인물 변화 성공 공유형","narrative_family":"nearby_person_transformation","reference_formats":["case_study","narrative","educational"],"emotional_arc":"주변 인물 변화 시작 → 부족한 조건 속 성과 → 노하우 공유 → 주도적 변화 확인 → 함께 가능하다는 제안","use_when":["가족/지인 변화 사례","운동/학습/습관","코칭 콘텐츠","사례 기반 교육"],"avoid_when":["실제 사례 없음","단순 제품 광고","강한 판매"],"body_flow_rule":"가까운 인물의 변화를 통해 솔루션의 현실성과 따라 할 수 있다는 믿음을 만든다.","rewrite_rule":"사례의 주인공을 존중하며, 변화 과정과 가능성에 집중한다.","risk_note":"가족/지인 사례와 성과 수치를 허위로 만들지 않는다.","use_intensity":"medium_only_with_case","search_text":"주변 인물 변화 시작 부족한 조건 성과 노하우 알려줬더니 혼자서도 해냄 여러분도 가능"},
{"narrative_code":"NARRATIVE_28","title":"믿기지 않는 과거 결핍 극복형","narrative_family":"hidden_past_to_current_confidence","reference_formats":["narrative"],"emotional_arc":"현재 모습 위 반전 고백 → 숨기고 싶던 결핍 → 자각과 작은 실천 → 현재 성취 → 시청자 확신","use_when":["자기계발","발표/외모/멘탈 극복","성장 서사","멘토형 콘텐츠"],"avoid_when":["정보형","리뷰","할인/혜택 안내"],"body_flow_rule":"현재 당당한 모습과 믿기 어려운 과거를 대비하고, 작은 실천이 변화의 시작이었다고 보여준다.","rewrite_rule":"극복 서사는 구체적인 작은 행동을 포함해야 진정성이 산다.","risk_note":"심리 문제, 공포증, 은둔 같은 표현은 진단처럼 단정하지 않는다.","use_intensity":"medium","search_text":"믿기지 않겠지만 과거 결핍 숨기고 살았음 더 이상 이렇게 살 순 없다 작은 실천 현재 성취 해냈다면"},
{"narrative_code":"NARRATIVE_29","title":"성공자의 한마디를 내면화하는 가이드형","narrative_family":"mentor_quote_internalized_rule","reference_formats":["educational","narrative"],"emotional_arc":"성공자에게 질문 → 의외의 한마디 → 핵심 키워드 3개 → 유혹 속 반복 → 결과 궁금증","use_when":["운동/식단","공부법","습관 형성","전문가 조언 콘텐츠"],"avoid_when":["근거 없는 전문가 인용","브랜드 세일즈","지원금/혜택"],"body_flow_rule":"성공자의 간단한 원칙을 받아들이고, 유혹의 순간마다 반복하며 변화로 이어가는 구조다.","rewrite_rule":"전문가 조언은 실제 근거가 없으면 ‘제가 배운 원칙’처럼 완화한다.","risk_note":"실제 인물/전문가 발언을 허위 인용하지 않는다.","use_intensity":"low_to_medium","search_text":"성공자에게 물어봄 딱 한 말씀 소박한 습관 3가지 키워드 유혹 내면화"},
{"narrative_code":"NARRATIVE_30","title":"성공했지만 불안한 과거 회상형","narrative_family":"success_with_unresolved_fear","reference_formats":["narrative"],"emotional_arc":"현재 성공과 불안 → 가난했던 과거 → 좋아하던 일의 현실 좌절 → 월급/한계 현타 → 결단 예고","use_when":["창업자 서사","커리어 전환","성공 뒤 불안","다음 편 유도형 브랜딩"],"avoid_when":["단순 정보","제품 판매","가벼운 꿀팁"],"body_flow_rule":"현재 성공을 먼저 보여주지만 행복만 있는 게 아니라는 반전 감정으로 시작해, 과거 결핍과 결단으로 이어간다.","rewrite_rule":"성공 수치보다 불안과 결핍이 결단으로 이어지는 흐름을 중심으로 쓴다.","risk_note":"매출, 연봉, 월급, 가난한 환경 등은 사용자 입력 없이 만들지 않는다.","use_intensity":"medium","search_text":"성공했지만 불안 월매출 과거 가난 직업 현실 좌절 월급 현타 이대로는 안 되겠다 결단"}
]
$seed$::jsonb) as data(
    narrative_code text,
    title text,
    narrative_family text,
    reference_formats text[],
    emotional_arc text,
    use_when text[],
    avoid_when text[],
    body_flow_rule text,
    rewrite_rule text,
    risk_note text,
    use_intensity text,
    search_text text
  )
)
insert into public.narrative_patterns (
  narrative_code,
  title,
  narrative_family,
  reference_formats,
  emotional_arc,
  structure_steps,
  use_when,
  avoid_when,
  body_flow_rule,
  rewrite_rule,
  risk_note,
  use_intensity,
  search_text,
  metadata
)
select
  narrative_code,
  title,
  narrative_family,
  reference_formats,
  emotional_arc,
  '[]'::jsonb,
  use_when,
  avoid_when,
  body_flow_rule,
  rewrite_rule,
  risk_note,
  use_intensity,
  search_text,
  jsonb_build_object(
    'source', 'seed_narrative_patterns_v1',
    'raw_templates_stored', false,
    'examples_stored', false,
    'urls_stored', false,
    'default_connection', 'explicit_user_request_only'
  )
from seed_data
on conflict (narrative_code) do update set
  title = excluded.title,
  narrative_family = excluded.narrative_family,
  reference_formats = excluded.reference_formats,
  emotional_arc = excluded.emotional_arc,
  use_when = excluded.use_when,
  avoid_when = excluded.avoid_when,
  body_flow_rule = excluded.body_flow_rule,
  rewrite_rule = excluded.rewrite_rule,
  risk_note = excluded.risk_note,
  use_intensity = excluded.use_intensity,
  search_text = excluded.search_text,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = timezone('utc', now());
