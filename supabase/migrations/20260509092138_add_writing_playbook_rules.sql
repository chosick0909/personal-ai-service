-- Writing playbook rules are abstract sentence-level rewrite rules only.
-- Do not store book source text in this table or inject output_style_example into generation prompts.

create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.writing_playbook_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  stage text not null check (stage in ('HOOK', 'BODY', 'CTA', 'STYLE', 'VALIDATION')),
  sentence_role text not null check (sentence_role in (
    'HOOK_START',
    'HOOK_EXPAND',
    'BODY_PROBLEM',
    'BODY_CAUSE',
    'BODY_SOLUTION',
    'BODY_PROOF',
    'BODY_TRANSITION',
    'CTA',
    'STYLE',
    'VALIDATION'
  )),
  role text not null,
  funnel_stage text not null check (funnel_stage in (
    'attention',
    'empathy',
    'tension',
    'trust',
    'solution',
    'action',
    'clarity',
    'validation'
  )),
  purpose text not null,
  use_when text[] not null default '{}',
  do_items text[] not null default '{}',
  dont_items text[] not null default '{}',
  rewrite_pattern text not null,
  input_role_example text not null default '',
  output_style_example text not null default '',
  structure_risk text not null check (structure_risk in ('low', 'medium', 'high')),
  risk_level text not null default 'safe' check (risk_level in ('safe', 'review', 'blocked')),
  retrieval_tags text[] not null default '{}',
  variant_scope text[] not null default '{}',
  priority integer not null check (priority between 1 and 5),
  source_similarity_score numeric(5,4),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint writing_playbook_rules_source_similarity_range
    check (source_similarity_score is null or (source_similarity_score >= 0 and source_similarity_score <= 1))
);

create index if not exists writing_playbook_rules_stage_sentence_role_idx
  on public.writing_playbook_rules (stage, sentence_role, is_active);

create index if not exists writing_playbook_rules_risk_priority_idx
  on public.writing_playbook_rules (risk_level, structure_risk, priority desc);

create index if not exists writing_playbook_rules_tags_gin_idx
  on public.writing_playbook_rules using gin (retrieval_tags);

create index if not exists writing_playbook_rules_variant_scope_gin_idx
  on public.writing_playbook_rules using gin (variant_scope);

drop trigger if exists set_writing_playbook_rules_updated_at on public.writing_playbook_rules;

create trigger set_writing_playbook_rules_updated_at
before update on public.writing_playbook_rules
for each row
execute function public.set_updated_at();

alter table public.writing_playbook_rules enable row level security;

drop policy if exists "Service role full access writing_playbook_rules"
on public.writing_playbook_rules;

create policy "Service role full access writing_playbook_rules"
on public.writing_playbook_rules
for all
to service_role
using (true)
with check (true);

create or replace function public.match_writing_playbook_rules(
  query_embedding vector(1536),
  target_sentence_role text,
  target_stage text,
  target_variant text default null,
  match_count int default 3,
  include_validation boolean default false
)
returns table (
  id uuid,
  rule_key text,
  stage text,
  sentence_role text,
  role text,
  funnel_stage text,
  purpose text,
  use_when text[],
  do_items text[],
  dont_items text[],
  rewrite_pattern text,
  structure_risk text,
  risk_level text,
  retrieval_tags text[],
  variant_scope text[],
  priority integer,
  metadata jsonb,
  similarity double precision,
  final_rank double precision
)
language sql
stable
as $$
  with filtered as (
    select wpr.*
    from public.writing_playbook_rules wpr
    where wpr.embedding is not null
      and wpr.is_active = true
      and wpr.risk_level <> 'blocked'
      and (include_validation = true or wpr.stage <> 'VALIDATION')
      and (include_validation = false or wpr.stage = 'VALIDATION')
      and (
        include_validation = true
        or wpr.sentence_role = target_sentence_role
        or wpr.sentence_role = 'STYLE'
      )
      and (
        include_validation = true
        or wpr.stage = target_stage
        or wpr.stage = 'STYLE'
      )
      and (
        target_variant is null
        or coalesce(array_length(wpr.variant_scope, 1), 0) = 0
        or target_variant = any(wpr.variant_scope)
      )
  ), ranked as (
    select
      filtered.*,
      1 - (filtered.embedding <=> query_embedding) as similarity,
      ((1 - (filtered.embedding <=> query_embedding)) * 0.75) + ((filtered.priority::double precision / 5.0) * 0.25) as final_rank
    from filtered
  )
  select
    ranked.id,
    ranked.rule_key,
    ranked.stage,
    ranked.sentence_role,
    ranked.role,
    ranked.funnel_stage,
    ranked.purpose,
    ranked.use_when,
    ranked.do_items,
    ranked.dont_items,
    ranked.rewrite_pattern,
    ranked.structure_risk,
    ranked.risk_level,
    ranked.retrieval_tags,
    ranked.variant_scope,
    ranked.priority,
    ranked.metadata,
    ranked.similarity,
    ranked.final_rank
  from ranked
  order by ranked.final_rank desc
  limit least(greatest(match_count, 1), 8);
$$;

with raw(data) as (
  values ($writing_rules$[
  {
    "rule_key": "hook_pain_question_gap",
    "original_rule_id": "hook_pain_question_gap",
    "stage": "HOOK",
    "sentence_role": "HOOK_START",
    "role": "pain_question",
    "funnel_stage": "attention",
    "purpose": "타겟의 반복 행동과 기대 결과 사이의 간극을 질문형으로 찔러 첫 문장의 자기관련성을 높인다.",
    "use_when": [
      "레퍼런스 첫 문장이 문제 제기 질문일 때",
      "사용자 주제에 반복 실패, 정체, 노력 대비 결과 부족이 있을 때",
      "문장 역할이 훅이지만 해결책을 아직 말하면 안 될 때"
    ],
    "do_items": [
      "레퍼런스의 질문형 또는 문제 제기 구조를 유지한다",
      "타겟의 반복 행동과 얻지 못한 결과를 한 문장에 담는다",
      "현재 상태와 원하는 결과의 간극을 구체 장면으로 표현한다",
      "문장 길이는 레퍼런스 대응 문장과 비슷하게 유지한다"
    ],
    "dont_items": [
      "해결책을 첫 문장에 먼저 공개하지 않는다",
      "타겟을 조롱하거나 무능하게 보이게 하지 않는다",
      "레퍼런스의 훅 위치를 뒤로 옮기지 않는다",
      "과장된 공포나 보장 표현을 사용하지 않는다"
    ],
    "rewrite_pattern": "{반복 행동/노력}은 하고 있는데, 아직도 {기대 결과}가 안 나오나요?",
    "input_role_example": "반복되는 실패 상황을 질문으로 찌르는 훅",
    "output_style_example": "식단도 운동도 하는데, 체중이 계속 제자리인가요?",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "default_safe",
      "effort_result",
      "gap",
      "hook",
      "pain",
      "question",
      "reference_structure",
      "sentence_rewrite",
      "stagnation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "hook_pain"
    }
  },
  {
    "rule_key": "hook_curiosity_missing_piece",
    "original_rule_id": "hook_curiosity_missing_piece",
    "stage": "HOOK",
    "sentence_role": "HOOK_START",
    "role": "curiosity_gap",
    "funnel_stage": "attention",
    "purpose": "타겟이 놓치고 있는 한 가지 요소를 암시해 다음 문장을 보게 만든다.",
    "use_when": [
      "레퍼런스 훅이 궁금증 유발형일 때",
      "문제의 원인을 바로 설명하지 않고 열어두는 흐름일 때",
      "C안처럼 후킹 압력을 조금 높여야 할 때",
      "레퍼런스 role sequence에 hook_curiosity 또는 open_loop 슬롯이 있을 때만 사용한다"
    ],
    "do_items": [
      "원문이 숨긴 정보의 위치를 유지한다",
      "타겟이 알고 싶어 할 빈칸을 한 가지로 좁힌다",
      "다음 문장에서 해소될 만한 기대를 만든다",
      "질문형 또는 미완성 암시형으로 짧게 쓴다"
    ],
    "dont_items": [
      "새로운 전개를 추가하지 않는다",
      "한 문장에 원인 후보를 과하게 늘어놓지 않는다",
      "정답을 훅에서 완전히 공개하지 않는다",
      "레퍼런스보다 훨씬 자극적인 주장을 만들지 않는다",
      "레퍼런스가 문제 질문형이면 curiosity형으로 임의 전환하지 않는다"
    ],
    "rewrite_pattern": "문제는 {표면 원인}이 아니라, 대부분 놓치는 {숨은 변수}에 있습니다.",
    "input_role_example": "원인을 숨기고 다음 설명을 보게 하는 훅",
    "output_style_example": "문제는 운동 시간이 아니라, 몸이 바뀌는 순서를 놓친 데 있습니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "curiosity",
      "hidden_cause",
      "hook",
      "medium_use_only_when_reference_slot_matches",
      "open_loop",
      "shortform",
      "slot_required",
      "transition",
      "variant_c"
    ],
    "variant_scope": [
      "C안"
    ],
    "priority": 4,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "hook_curiosity"
    }
  },
  {
    "rule_key": "hook_mistake_cause_list",
    "original_rule_id": "hook_mistake_cause_list",
    "stage": "HOOK",
    "sentence_role": "HOOK_EXPAND",
    "role": "false_cause_list",
    "funnel_stage": "tension",
    "purpose": "타겟이 흔히 의심하는 원인들을 짧게 나열해 문제 인식과 공감을 동시에 만든다.",
    "use_when": [
      "레퍼런스가 흔한 원인 추측을 나열할 때",
      "타겟이 잘못된 기준으로 문제를 판단하는 상황일 때",
      "문장 역할이 문제 원인 고민 또는 훅 이후 공감 확장일 때"
    ],
    "do_items": [
      "레퍼런스의 나열 구조를 유지한다",
      "타겟이 실제로 의심할 만한 원인을 2~3개만 넣는다",
      "항목은 같은 문법 형태로 맞춘다",
      "마지막에 더 깊은 원인으로 넘어갈 여지를 남긴다"
    ],
    "dont_items": [
      "너무 많은 원인을 넣어 리듬을 깨지 않는다",
      "타겟을 무능하게 보이게 하지 않는다",
      "레퍼런스에 없는 긴 설명을 추가하지 않는다",
      "원인 나열 순서를 CTA 뒤로 옮기지 않는다"
    ],
    "rewrite_pattern": "{원인 후보 A} 때문일까, {원인 후보 B} 때문일까 계속 고민했을 거예요.",
    "input_role_example": "흔한 원인 고민을 나열하는 문장",
    "output_style_example": "운동량 때문일까, 식단 때문일까 계속 고민했을 거예요.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "cause_list",
      "default_safe",
      "empathy",
      "hook",
      "list",
      "mistake",
      "problem_awareness",
      "sentence_mapping"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "hook_mistake"
    }
  },
  {
    "rule_key": "hook_identity_or_warning_callout",
    "original_rule_id": "hook_identity_or_warning_callout",
    "stage": "HOOK",
    "sentence_role": "HOOK_START",
    "role": "target_callout_warning",
    "funnel_stage": "attention",
    "purpose": "명확한 타겟 호출 또는 현실적 경고로 첫 문장의 관련성을 높이되 공포 과장은 막는다.",
    "use_when": [
      "레퍼런스 첫 문장이 특정 사람을 부르거나 주의를 환기할 때",
      "사용자 세팅에 명확한 타겟이 있을 때",
      "사용자 카테고리에 방치 비용이 현실적으로 설명될 수 있을 때",
      "레퍼런스 훅의 문장 기능이 callout 또는 warning일 때만 사용한다"
    ],
    "do_items": [
      "타겟의 현재 상태나 정체성을 짧게 부른다",
      "경고형이면 실제로 중요한 손실만 제시한다",
      "호출 뒤에는 레퍼런스의 문제 제기 흐름을 따른다",
      "다음 문장에서 공감 또는 원인 설명으로 이어지게 한다"
    ],
    "dont_items": [
      "타겟을 조롱하거나 낙인찍지 않는다",
      "허위 공포를 만들지 않는다",
      "레퍼런스가 질문형인데 무조건 경고형으로 바꾸지 않는다",
      "경고 뒤에 바로 판매하지 않는다",
      "A안 원본형에서는 레퍼런스가 callout/warning이 아니면 사용하지 않는다"
    ],
    "rewrite_pattern": "{타겟 정체성/상태}라면, {현재 문제/현실적 손실}을 한 번쯤 겪었을 겁니다.",
    "input_role_example": "특정 타겟을 부르거나 주의를 환기하는 훅",
    "output_style_example": "운동을 막 시작한 사람이라면, 열심히 하는데 몸이 그대로인 순간을 겪었을 겁니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "a_variant_restricted",
      "ethical",
      "hook",
      "identity",
      "medium_use_only_when_reference_slot_matches",
      "personalization",
      "risk",
      "self_relevance",
      "target",
      "warning"
    ],
    "variant_scope": [
      "B안",
      "C안"
    ],
    "priority": 4,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "hook_pain"
    }
  },
  {
    "rule_key": "body_empathy_specific_scene",
    "original_rule_id": "body_empathy_specific_scene",
    "stage": "BODY",
    "sentence_role": "BODY_PROBLEM",
    "role": "empathy_scene",
    "funnel_stage": "empathy",
    "purpose": "추상적인 공감을 타겟의 실제 장면으로 바꿔 몰입감을 높인다.",
    "use_when": [
      "레퍼런스 문장이 공감 상황 확장 역할일 때",
      "사용자 세팅에 타겟의 일상 장면이 있을 때",
      "문장이 너무 일반적인 위로처럼 보일 때"
    ],
    "do_items": [
      "타겟이 겪는 시간, 장소, 행동 중 하나를 구체화한다",
      "원문 문장 수와 위치를 유지한다",
      "감정을 직접 말하기보다 장면으로 느끼게 한다",
      "말투는 사용자 캐릭터 설정에 맞춘다"
    ],
    "dont_items": [
      "공감 문장을 해결책 설명으로 바꾸지 않는다",
      "새로운 사례 단락을 추가하지 않는다",
      "책의 사례를 가져오지 않는다",
      "감정 단어만 반복하지 않는다"
    ],
    "rewrite_pattern": "{구체 행동}까지 했는데 {기대와 다른 결과}가 나오면, 누구라도 {감정}할 수밖에 없습니다.",
    "input_role_example": "타겟의 답답함을 장면으로 확장하는 문장",
    "output_style_example": "퇴근 후 헬스장까지 갔는데 변화가 안 보이면, 누구라도 의심하게 됩니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "body",
      "default_safe",
      "empathy",
      "scene",
      "sentence_rewrite",
      "specificity",
      "target_context"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_empathy"
    }
  },
  {
    "rule_key": "body_cause_plain_language_objection",
    "original_rule_id": "body_cause_plain_language_objection",
    "stage": "BODY",
    "sentence_role": "BODY_CAUSE",
    "role": "plain_cause_objection",
    "funnel_stage": "tension",
    "purpose": "원인 설명과 예상 반박 해소를 타겟의 생활 언어로 바꿔 이해 저항을 낮춘다.",
    "use_when": [
      "레퍼런스 문장이 원인 진단, 의문 해소, 반박 무마 역할일 때",
      "사용자 분야에 전문용어가 많을 때",
      "설득 흐름이 납득 없이 CTA로 넘어갈 때",
      "레퍼런스에 objection 또는 cause 슬롯이 있을 때만 반박 해소 표현을 사용한다"
    ],
    "do_items": [
      "전문 개념을 타겟의 생활 언어로 치환한다",
      "한 문장에는 하나의 원인 또는 하나의 반박만 담는다",
      "반박 뒤에는 짧은 이유나 기준을 붙인다",
      "공격적 반박 대신 이해시키는 어조를 사용한다"
    ],
    "dont_items": [
      "레퍼런스에 없는 FAQ 단락을 추가하지 않는다",
      "전문용어를 여러 개 쌓지 않는다",
      "원인을 단정적으로 과장하지 않는다",
      "타겟을 비난하거나 근거 없는 약속으로 의문을 덮지 않는다",
      "반박 해소를 위해 문장 수를 추가하지 않는다"
    ],
    "rewrite_pattern": "{예상 의문/표면 원인}라고 느낄 수 있지만, 핵심은 {타겟 언어로 바꾼 실제 기준}입니다.",
    "input_role_example": "문제의 실제 원인을 설명하거나 의문을 해소하는 문장",
    "output_style_example": "운동을 더 해야 한다고 느낄 수 있지만, 핵심은 더 오래가 아니라 같은 자극을 쌓는 기준입니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "body",
      "cause",
      "clarity",
      "diagnosis",
      "medium_use_only_when_reference_slot_matches",
      "no_new_faq",
      "objection",
      "plain_language",
      "reader_language",
      "trust"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_cause"
    }
  },
  {
    "rule_key": "body_mechanism_reason_bridge",
    "original_rule_id": "body_mechanism_reason_bridge",
    "stage": "BODY",
    "sentence_role": "BODY_SOLUTION",
    "role": "mechanism_bridge",
    "funnel_stage": "solution",
    "purpose": "주장과 해결책 사이에 한 단계짜리 이유를 붙여 레퍼런스의 논리 흐름을 유지한다.",
    "use_when": [
      "레퍼런스가 원리 설명 또는 메커니즘 설명을 포함할 때",
      "생성문이 주장만 있고 이유가 부족할 때",
      "CTA로 가기 전 논리 다리가 필요할 때"
    ],
    "do_items": [
      "원문 문장의 설명 단계 수를 유지한다",
      "원인에서 결과로 이어지는 연결어를 명확히 둔다",
      "한 문장에 하나의 논리만 넣는다",
      "이유는 타겟의 경험과 연결한다"
    ],
    "dont_items": [
      "새로운 프레임워크를 추가하지 않는다",
      "설명 순서를 앞뒤로 바꾸지 않는다",
      "레퍼런스에 없는 통계나 권위를 만들지 않는다",
      "문장 하나에 이유를 여러 개 넣지 않는다"
    ],
    "rewrite_pattern": "{주장/문제 현상}. 왜냐하면 {타겟이 체감할 수 있는 작동 원리} 때문입니다.",
    "input_role_example": "주장을 납득시키는 이유 문장",
    "output_style_example": "루틴을 자주 바꾸면 변화가 늦어집니다. 몸이 적응할 만큼 같은 자극이 쌓이지 않기 때문입니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "body",
      "bridge",
      "cause_effect",
      "default_safe",
      "logic",
      "mechanism",
      "persuasion",
      "reason_why"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_mechanism"
    }
  },
  {
    "rule_key": "body_proof_real_evidence_only",
    "original_rule_id": "body_proof_real_evidence_only",
    "stage": "BODY",
    "sentence_role": "BODY_PROOF",
    "role": "real_evidence_only",
    "funnel_stage": "trust",
    "purpose": "레퍼런스의 증거 제시 위치에서만 실제 경험, 수치, 제한 인정으로 신뢰를 보강한다.",
    "use_when": [
      "레퍼런스 문장이 경험, 결과, 권위, 사례, 약점 인정 역할일 때",
      "사용자 세팅에 실적이나 경험 정보가 있을 때",
      "주장이 믿기 어렵거나 과장처럼 느껴질 때",
      "검증 가능한 사용자 제공 증거가 있을 때만 사용한다"
    ],
    "do_items": [
      "레퍼런스에 증거 문장이 있는 위치에서만 사용한다",
      "숫자, 기간, 반복 경험 중 검증 가능한 요소를 우선 쓴다",
      "실제 경험이 있는 범위에서만 1인칭을 사용한다",
      "제한점은 짧게 인정하고 맞는 대상이나 기준으로 연결한다"
    ],
    "dont_items": [
      "없는 실적이나 경험을 만들지 않는다",
      "책 저자나 책 사례를 사용자 경험처럼 바꾸지 않는다",
      "허위 권위나 결과 보장 표현을 넣지 않는다",
      "증거 문장을 CTA나 새 단락으로 확장하지 않는다",
      "사용자 세팅에 증거가 없으면 generic proof를 생성하지 않는다"
    ],
    "rewrite_pattern": "제가 {실제 관찰/기간/대상}에서 확인한 건, {검증 가능한 짧은 관찰}입니다.",
    "input_role_example": "경험이나 관찰로 신뢰를 보강하는 문장",
    "output_style_example": "제가 초보 회원들을 보며 확인한 건, 오래 하는 사람보다 같은 자극을 쌓는 사람이 먼저 흔들리지 않는다는 점입니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "body",
      "credibility",
      "evidence",
      "experience",
      "limitation",
      "medium_requires_user_evidence",
      "no_fabrication",
      "proof",
      "slot_required",
      "trust"
    ],
    "variant_scope": [],
    "priority": 4,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_proof"
    }
  },
  {
    "rule_key": "body_transition_reframe_to_clue",
    "original_rule_id": "body_transition_reframe_to_clue",
    "stage": "BODY",
    "sentence_role": "BODY_TRANSITION",
    "role": "reframe_transition",
    "funnel_stage": "tension",
    "purpose": "문제 공감에서 해결 실마리로 넘어갈 때 같은 사실을 새 기준으로 보게 만든다.",
    "use_when": [
      "레퍼런스 중간에 분위기가 문제에서 해결로 전환될 때",
      "레퍼런스가 관점 전환이나 인식 변화 역할을 할 때",
      "타겟이 문제를 잘못 해석하고 있을 때",
      "레퍼런스 role sequence에 transition 또는 reframe 슬롯이 있을 때만 사용한다"
    ],
    "do_items": [
      "전환 문장의 위치를 레퍼런스와 맞춘다",
      "기존 해석과 새 해석을 짧게 대비한다",
      "해결책 전체가 아니라 첫 단서나 기준만 제시한다",
      "새 관점이 다음 해결 문장으로 이어지게 한다"
    ],
    "dont_items": [
      "전환을 훅 앞으로 당기지 않는다",
      "대본 전체 관점을 새로 설계하지 않는다",
      "전환 문장에서 CTA를 말하지 않는다",
      "레퍼런스에 없는 긴 비유를 만들지 않는다",
      "레퍼런스의 원래 전환 위치를 바꾸지 않는다"
    ],
    "rewrite_pattern": "이건 {기존 해석}의 문제가 아니라, 먼저 {새 기준}을 봐야 하는 문제입니다.",
    "input_role_example": "문제에서 해결 실마리로 넘어가는 문장",
    "output_style_example": "이건 의지의 문제가 아니라, 몸이 반응할 만큼 자극이 쌓였는지부터 봐야 하는 문제입니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "body",
      "flow",
      "medium_use_only_when_reference_slot_matches",
      "perception",
      "reframe",
      "solution_clue",
      "structure_guard",
      "transition",
      "transition_position_locked"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_transition"
    }
  },
  {
    "rule_key": "body_future_benefit_when_reference_has_slot",
    "original_rule_id": "body_future_benefit_when_reference_has_slot",
    "stage": "BODY",
    "sentence_role": "BODY_SOLUTION",
    "role": "future_benefit_slot",
    "funnel_stage": "solution",
    "purpose": "레퍼런스에 결과 상상 문장이 있을 때만 해결 후 체감 상태를 짧게 보여준다.",
    "use_when": [
      "레퍼런스가 결과 상상 또는 미래 체감 문장을 포함할 때",
      "사용자 상품의 사용 후 상태를 짧게 보여줘야 할 때",
      "CTA 전에 기대감을 만들 필요가 있을 때",
      "레퍼런스에 future_benefit 슬롯이 있을 때만 사용한다"
    ],
    "do_items": [
      "미래 상태를 타겟의 일상 장면으로 표현한다",
      "레퍼런스에 미래 상상 문장이 있을 때만 사용한다",
      "결과를 보장하지 않고 가능성이나 방향으로 표현한다",
      "문장 길이를 짧게 유지한다"
    ],
    "dont_items": [
      "레퍼런스에 없는 상상 장면을 새로 끼워 넣지 않는다",
      "비현실적 결과를 약속하지 않는다",
      "책의 상상 유도 문구를 그대로 쓰지 않는다",
      "CTA보다 앞에서 구매 압박을 만들지 않는다",
      "미래 체감 문장을 새 문장으로 추가하지 않는다"
    ],
    "rewrite_pattern": "{해결 기준}을 잡으면, {타겟의 일상 행동}이 조금 더 쉬워집니다.",
    "input_role_example": "해결 후 체감 상태를 보여주는 문장",
    "output_style_example": "자극 기준을 잡으면, 오늘 어떤 운동을 해야 할지 덜 흔들리게 됩니다.",
    "structure_risk": "medium",
    "risk_level": "review",
    "retrieval_tags": [
      "benefit",
      "body",
      "experience",
      "future_pacing",
      "medium_use_only_when_reference_slot_matches",
      "no_guarantee",
      "no_new_future_scene",
      "transition"
    ],
    "variant_scope": [
      "B안",
      "C안"
    ],
    "priority": 3,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "body_mechanism"
    }
  },
  {
    "rule_key": "cta_single_next_action",
    "original_rule_id": "cta_single_next_action",
    "stage": "CTA",
    "sentence_role": "CTA",
    "role": "single_next_action",
    "funnel_stage": "action",
    "purpose": "레퍼런스의 CTA 위치에서 사용자 세팅에 맞는 하나의 다음 행동만 제안한다.",
    "use_when": [
      "레퍼런스 CTA가 저장, 댓글, 문의, 신청, 구매 등 행동 유도일 때",
      "사용자 선호 CTA 또는 수익화 방식이 명확할 때",
      "마지막 문장이 여러 행동으로 흩어져 있을 때"
    ],
    "do_items": [
      "CTA 위치를 레퍼런스와 동일하게 유지한다",
      "행동은 하나만 선택한다",
      "행동 후 얻는 작은 이득이나 이유를 같이 말한다",
      "레퍼런스의 CTA 강도를 넘지 않는다"
    ],
    "dont_items": [
      "CTA를 훅이나 본문 중간으로 이동하지 않는다",
      "댓글, 저장, 구매를 한 문장에 모두 넣지 않는다",
      "레퍼런스가 부드러운 CTA인데 강매형으로 바꾸지 않는다",
      "상품이 없는 경우 구매 유도를 만들지 않는다"
    ],
    "rewrite_pattern": "{원하는 결과}가 필요하다면, 먼저 {단일 다음 행동}부터 해보세요.",
    "input_role_example": "다음 행동 하나를 제안하는 CTA",
    "output_style_example": "내 몸에 맞는 운동 순서가 필요하다면, 먼저 저장해두고 오늘 루틴부터 점검해보세요.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "conversion",
      "cta",
      "default_safe",
      "direct",
      "monetization",
      "next_step",
      "preference",
      "single_action",
      "soft_sell"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "cta_soft_sell"
    }
  },
  {
    "rule_key": "style_spoken_voice_preserve_role",
    "original_rule_id": "style_spoken_voice_preserve_role",
    "stage": "STYLE",
    "sentence_role": "STYLE",
    "role": "spoken_voice",
    "funnel_stage": "clarity",
    "purpose": "문장을 사람 말처럼 자연스럽게 바꾸되 레퍼런스의 역할과 정보 배치는 유지한다.",
    "use_when": [
      "B안 대화형 변형을 만들 때",
      "초안이 번역체나 설명문처럼 느껴질 때",
      "사용자 말투 설정이 캐주얼하거나 친근할 때"
    ],
    "do_items": [
      "입으로 읽었을 때 어색한 연결을 줄인다",
      "문장 역할과 순서를 그대로 둔다",
      "사용자 캐릭터의 말투 강도를 반영한다",
      "딱딱한 명사를 쉬운 표현으로 바꾼다"
    ],
    "dont_items": [
      "대화형으로 바꾸며 새 문장을 추가하지 않는다",
      "레퍼런스의 정보 순서를 바꾸지 않는다",
      "반말/존댓말을 사용자 설정과 다르게 섞지 않는다",
      "불필요한 감탄사를 남발하지 않는다"
    ],
    "rewrite_pattern": "{딱딱한 설명} → {같은 뜻의 구어체 한 문장}",
    "input_role_example": "설명은 맞지만 입말로는 어색한 문장",
    "output_style_example": "쉽게 말하면, 오래 한 게 아니라 제대로 쌓인 자극이 몸을 바꿉니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "default_safe",
      "natural",
      "role_preservation",
      "spoken_tone",
      "style",
      "variant_b",
      "voice"
    ],
    "variant_scope": [
      "B안"
    ],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "spoken_tone"
    }
  },
  {
    "rule_key": "style_rhythm_question_compression",
    "original_rule_id": "style_rhythm_question_compression",
    "stage": "STYLE",
    "sentence_role": "STYLE",
    "role": "rhythm_compression",
    "funnel_stage": "clarity",
    "purpose": "질문, 짧은 압박문, 설명문을 레퍼런스 문장 형태에 맞춰 조정해 숏폼 청취 리듬을 만든다.",
    "use_when": [
      "문장이 모두 비슷한 길이로 늘어질 때",
      "레퍼런스 문장이 질문형인데 치환문이 평서문으로 바뀌었을 때",
      "C안 후킹형에서 압축감이 필요할 때",
      "TTS로 읽었을 때 호흡이 답답할 때"
    ],
    "do_items": [
      "레퍼런스의 문장 수와 질문/평서 형태를 우선 유지한다",
      "중요한 압박 문장은 짧게 둔다",
      "질문은 한 번에 하나만 묻는다",
      "의미가 겹치는 완충어를 제거한다"
    ],
    "dont_items": [
      "리듬을 위해 문장 순서를 바꾸지 않는다",
      "모든 문장을 질문으로 바꾸지 않는다",
      "문장 수를 크게 늘리거나 줄이지 않는다",
      "짧게 만든다고 핵심 정보를 삭제하지 않는다"
    ],
    "rewrite_pattern": "{긴 설명문/힘 약한 평서문} → {레퍼런스 형태를 유지한 짧은 질문 또는 압축문}",
    "input_role_example": "리듬이 늘어지거나 질문 기능이 약해진 문장",
    "output_style_example": "운동량만 늘리면 안 됩니다. 몸은 반복된 자극에 먼저 반응하니까요.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "compression",
      "default_safe",
      "question",
      "rhythm",
      "sentence_form",
      "shortform",
      "style",
      "tts",
      "variant_c"
    ],
    "variant_scope": [
      "B안",
      "C안"
    ],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "sentence_rhythm"
    }
  },
  {
    "rule_key": "style_specific_benefit_reader_view",
    "original_rule_id": "style_specific_benefit_reader_view",
    "stage": "STYLE",
    "sentence_role": "STYLE",
    "role": "specific_benefit",
    "funnel_stage": "solution",
    "purpose": "추상어, 기능 중심 표현, 작성자 중심 표현을 타겟의 구체 행동과 체감 이득으로 바꾼다.",
    "use_when": [
      "초안에 성장, 변화, 개선 같은 추상어가 많을 때",
      "사용자 상품/서비스 설명이 기능 나열로 끝날 때",
      "레퍼런스 문장이 독자 관점인데 생성문이 공급자 관점일 때"
    ],
    "do_items": [
      "추상 명사를 실제 행동, 장면, 결과로 바꾼다",
      "기능 뒤에 타겟이 얻는 구체 이득을 붙인다",
      "문장의 주어를 가능한 한 타겟 관점으로 바꾼다",
      "한 문장에 구체 디테일 하나만 넣는다"
    ],
    "dont_items": [
      "디테일을 추가하며 새 주장으로 확장하지 않는다",
      "없는 결과를 보장하지 않는다",
      "레퍼런스에 없는 브랜드 소개를 넣지 않는다",
      "문장 리듬을 해칠 정도로 긴 수식어를 붙이지 않는다"
    ],
    "rewrite_pattern": "{추상/기능/공급자 중심 표현} → {타겟이 실제로 보는 장면 + 체감 이득}",
    "input_role_example": "기능이나 추상어 중심으로 흐려진 문장",
    "output_style_example": "루틴 순서를 정리하면, 오늘 뭘 해야 할지 고민하는 시간이 줄어듭니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "benefit",
      "clarity",
      "concrete",
      "default_safe",
      "feature_to_outcome",
      "reader_viewpoint",
      "specificity",
      "style"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "specificity"
    }
  },
  {
    "rule_key": "style_one_sentence_one_role",
    "original_rule_id": "style_one_sentence_one_role",
    "stage": "STYLE",
    "sentence_role": "STYLE",
    "role": "one_sentence_one_role",
    "funnel_stage": "clarity",
    "purpose": "한 문장에 하나의 역할만 남겨 레퍼런스의 문장별 치환 구조를 선명하게 유지한다.",
    "use_when": [
      "한 문장에 공감, 원인, 해결, CTA가 섞였을 때",
      "문장별 역할 분석 결과와 생성문 역할이 어긋날 때",
      "내부 검증에서 구조 이탈이 감지될 때"
    ],
    "do_items": [
      "각 문장이 맡은 역할 하나만 수행하게 한다",
      "역할 밖 정보는 인접한 해당 역할 문장으로 옮기거나 제거한다",
      "문장별 role label과 생성문을 대조한다",
      "필요하면 같은 의미 안에서만 압축한다"
    ],
    "dont_items": [
      "역할을 분리한다는 이유로 문장 수를 크게 늘리지 않는다",
      "CTA를 BODY 문장에 섞지 않는다",
      "훅 문장에 증거와 해결책을 모두 넣지 않는다",
      "레퍼런스 순서를 재배열하지 않는다"
    ],
    "rewrite_pattern": "{복합 문장} → {현재 role에 해당하는 정보만 남긴 문장}",
    "input_role_example": "여러 역할이 섞여 구조가 흐려진 문장",
    "output_style_example": "지금 필요한 건 더 센 운동이 아니라, 같은 자극을 쌓는 순서입니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "clarity",
      "default_safe",
      "one_job",
      "sentence_role",
      "structure_guard",
      "style",
      "validation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "clarity"
    }
  },
  {
    "rule_key": "validation_reference_structure_similarity",
    "original_rule_id": "validation_reference_structure_similarity",
    "stage": "VALIDATION",
    "sentence_role": "VALIDATION",
    "role": "reference_structure_similarity",
    "funnel_stage": "validation",
    "purpose": "문장 수, 길이감, HOOK/BODY/CTA 순서가 레퍼런스에서 벗어나지 않도록 검사한다.",
    "use_when": [
      "A/B/C 생성 직후 내부 검증 단계",
      "문장별 치환 방식으로 초안을 만들었을 때",
      "RAG 규칙이 강하게 적용되어 전개가 바뀌었을 가능성이 있을 때"
    ],
    "do_items": [
      "생성문 문장 수를 레퍼런스 문장 수와 비교한다",
      "레퍼런스 role sequence와 생성문 role sequence를 비교한다",
      "각 문장 길이를 레퍼런스 대응 문장과 비교한다",
      "A안은 가장 엄격하게 검사한다"
    ],
    "dont_items": [
      "문장 수나 길이를 맞추기 위해 새 논점을 추가하지 않는다",
      "좋은 문장이라는 이유로 순서 변경을 허용하지 않는다",
      "CTA 위치를 이동하지 않는다",
      "레퍼런스에 없는 섹션을 만들지 않는다"
    ],
    "rewrite_pattern": "structure drift 감지 → 같은 role 내부에서만 압축/분리/재작성",
    "input_role_example": "레퍼런스보다 문장 수가 줄고 해결책이 공감보다 먼저 나온 초안",
    "output_style_example": "레퍼런스 9문장이라면 생성안도 8~10문장 안에서 HOOK/BODY/CTA 순서를 유지합니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "default_safe",
      "guardrail",
      "hook_body_cta",
      "length",
      "reference_similarity",
      "role_order",
      "sentence_count",
      "validation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "structure_guard"
    }
  },
  {
    "rule_key": "validation_source_and_context_leakage",
    "original_rule_id": "validation_source_and_context_leakage",
    "stage": "VALIDATION",
    "sentence_role": "VALIDATION",
    "role": "source_context_leakage",
    "funnel_stage": "validation",
    "purpose": "책 원문, 책 예시, 레퍼런스 고유 소재가 생성 대본에 섞이거나 사용자 세팅과 어긋나는 것을 막는다.",
    "use_when": [
      "RAG 검색 결과를 사용한 뒤",
      "생성문에 낯선 사례나 원문 같은 표현이 보일 때",
      "A/B/C 생성 후 최종 사용자 표시 직전"
    ],
    "do_items": [
      "책 OCR 텍스트와 n-gram 유사도를 검사한다",
      "레퍼런스 영상의 고유명사, 제목, 원래 산업군 표현이 남았는지 확인한다",
      "카테고리, 타겟, 상품, 말투, CTA, 금지 표현을 각각 대조한다",
      "유사도가 높은 표현은 의미 역할만 유지하고 사용자 주제 언어로 재작성한다"
    ],
    "dont_items": [
      "책 문장이나 예시를 스타일 예시로 그대로 남기지 않는다",
      "레퍼런스의 고유 상품명이나 제목을 새 주제에 끼워 넣지 않는다",
      "사용자 세팅에 없는 상품, 실적, 사례를 만들지 않는다",
      "개인화 메모리를 구조 변경 이유로 사용하지 않는다"
    ],
    "rewrite_pattern": "source/context mismatch 감지 → 같은 role 유지 + 사용자 세팅 값으로 재치환",
    "input_role_example": "레퍼런스 주제나 외부 원문 표현이 남은 초안",
    "output_style_example": "조회수 고민 문장을 운동 루틴 정체 문장으로 같은 위치에서 다시 바꿉니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "copyright",
      "default_safe",
      "guardrail",
      "leakage",
      "personalization",
      "rag",
      "reference_rewrite",
      "user_context",
      "validation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "structure_guard"
    }
  },
  {
    "rule_key": "validation_claim_ethics_guard",
    "original_rule_id": "validation_claim_ethics_guard",
    "stage": "VALIDATION",
    "sentence_role": "VALIDATION",
    "role": "claim_ethics_guard",
    "funnel_stage": "validation",
    "purpose": "후킹과 설득을 강화하더라도 조작, 허위 보장, 과도한 불안 자극을 걸러낸다.",
    "use_when": [
      "후킹형 문장이 지나치게 조작적이거나 공포 중심일 때",
      "문장에 쉽다, 빠르다, 바로, 보장 같은 표현이 들어갈 때",
      "건강, 돈, 교육처럼 결과 민감도가 높은 카테고리일 때"
    ],
    "do_items": [
      "타겟이 스스로 판단할 수 있는 표현을 남긴다",
      "빠름의 기준을 행동 시작이나 이해 수준으로 제한한다",
      "검증 불가능한 보장 문구를 제거한다",
      "과도한 위협 표현을 현실적인 문제 인식으로 낮춘다"
    ],
    "dont_items": [
      "불안만 키우고 해결 맥락이 없는 문장을 남기지 않는다",
      "단기간 결과를 보장하지 않는다",
      "허위 희소성이나 허위 권위를 만들지 않는다",
      "강제성 있는 표현을 CTA에 넣지 않는다"
    ],
    "rewrite_pattern": "{압박/공포/보장 중심 문장} → {문제 인식 + 선택 가능한 다음 행동}",
    "input_role_example": "불안을 과하게 자극하거나 빠른 성과를 보장하는 문장",
    "output_style_example": "몸이 바로 바뀌는 게 아니라, 왜 멈췄는지 기준부터 확인할 수 있습니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "claim_check",
      "default_safe",
      "ethics",
      "no_guarantee",
      "no_manipulation",
      "safety",
      "trust",
      "validation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "structure_guard"
    }
  },
  {
    "rule_key": "validation_context_before_rewrite",
    "original_rule_id": "validation_context_before_rewrite",
    "stage": "VALIDATION",
    "sentence_role": "VALIDATION",
    "role": "context_before_rewrite",
    "funnel_stage": "validation",
    "purpose": "사용자 주제 치환 전 필요한 소재가 부족한지 확인해 책 규칙이 내용을 대신 만들지 못하게 한다.",
    "use_when": [
      "사용자 세팅 정보가 부족한 상태에서 대본을 만들 때",
      "레퍼런스 구조는 명확하지만 새 주제 소재가 약할 때",
      "본문 증거와 원인 설명이 일반론으로 흐를 때"
    ],
    "do_items": [
      "카테고리, 타겟, 상품, CTA, 금지 표현을 먼저 확인한다",
      "부족한 값은 일반 창작으로 메우지 않고 안전한 범위로 축소한다",
      "문장별 치환표에 필요한 소재 슬롯을 표시한다",
      "RAG 규칙은 소재가 아니라 표현 보정으로만 쓴다"
    ],
    "dont_items": [
      "책 규칙으로 사용자 소재 부족을 대체하지 않는다",
      "없는 상품 정보나 실적을 생성하지 않는다",
      "레퍼런스 구조를 바꿔 빈칸을 숨기지 않는다",
      "모호한 타겟을 넓은 대중으로 임의 확장하지 않는다"
    ],
    "rewrite_pattern": "missing context 감지 → 해당 role 문장을 일반론으로 쓰지 않고 사용자 세팅 기반 소재 슬롯 요청/축소",
    "input_role_example": "사용자 정보가 부족해 일반론으로 변한 문장",
    "output_style_example": "타겟과 상품 정보가 없으면 구체 혜택 대신 확인 가능한 행동 기준만 사용합니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "default_safe",
      "no_fabrication",
      "rag_boundaries",
      "research",
      "rewrite_table",
      "user_context",
      "validation"
    ],
    "variant_scope": [],
    "priority": 5,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "structure_guard"
    }
  },
  {
    "rule_key": "validation_display_and_tts_readability",
    "original_rule_id": "validation_display_and_tts_readability",
    "stage": "VALIDATION",
    "sentence_role": "VALIDATION",
    "role": "display_tts_readability",
    "funnel_stage": "validation",
    "purpose": "생성 대본이 화면 표시와 TTS 읽기에 적합하도록 문장별 줄바꿈과 구간 구조를 유지한다.",
    "use_when": [
      "프론트에 HOOK/BODY/CTA로 표시하기 전",
      "문장이 길게 붙어 있어 읽기 어려울 때",
      "사용자가 A/B/C를 비교해야 할 때"
    ],
    "do_items": [
      "HOOK, BODY, CTA 구간을 명확히 분리한다",
      "문장별 줄바꿈을 유지한다",
      "긴 BODY는 레퍼런스 구간 안에서만 호흡을 나눈다",
      "A/B/C 모두 같은 구간 구조로 표시한다"
    ],
    "dont_items": [
      "시각적 보기 좋음을 이유로 전개 순서를 바꾸지 않는다",
      "카드 표시용 문구를 대본 본문에 섞지 않는다",
      "레퍼런스에 없는 제목을 대본 안에 추가하지 않는다",
      "문장별 대응 관계를 잃지 않는다"
    ],
    "rewrite_pattern": "display check → 문장별 줄바꿈 + HOOK/BODY/CTA 구간 유지",
    "input_role_example": "문장들이 한 덩어리로 붙은 생성 결과",
    "output_style_example": "HOOK 한 문장, BODY 여러 문장, CTA 한 문장처럼 레퍼런스 구간에 맞춰 표시합니다.",
    "structure_risk": "low",
    "risk_level": "safe",
    "retrieval_tags": [
      "abc",
      "default_safe",
      "display",
      "frontend",
      "hook_body_cta",
      "readability",
      "tts",
      "validation"
    ],
    "variant_scope": [],
    "priority": 4,
    "source_similarity_score": null,
    "metadata": {
      "source": "distilled_writing_playbook",
      "pipeline_step": "step6_normalized_seed",
      "source_text_stored": false,
      "output_example_prompt_excluded": true,
      "original_role": "structure_guard"
    }
  }
]$writing_rules$::jsonb)
), rows as (
  select
    item->>'rule_key' as rule_key,
    item->>'stage' as stage,
    item->>'sentence_role' as sentence_role,
    item->>'role' as role,
    item->>'funnel_stage' as funnel_stage,
    item->>'purpose' as purpose,
    array(select jsonb_array_elements_text(item->'use_when')) as use_when,
    array(select jsonb_array_elements_text(item->'do_items')) as do_items,
    array(select jsonb_array_elements_text(item->'dont_items')) as dont_items,
    item->>'rewrite_pattern' as rewrite_pattern,
    item->>'input_role_example' as input_role_example,
    item->>'output_style_example' as output_style_example,
    item->>'structure_risk' as structure_risk,
    item->>'risk_level' as risk_level,
    array(select jsonb_array_elements_text(item->'retrieval_tags')) as retrieval_tags,
    array(select jsonb_array_elements_text(item->'variant_scope')) as variant_scope,
    (item->>'priority')::integer as priority,
    nullif(item->>'source_similarity_score', '')::numeric as source_similarity_score,
    item->'metadata' as metadata
  from raw, jsonb_array_elements(data) as item
)
insert into public.writing_playbook_rules (
  rule_key,
  stage,
  sentence_role,
  role,
  funnel_stage,
  purpose,
  use_when,
  do_items,
  dont_items,
  rewrite_pattern,
  input_role_example,
  output_style_example,
  structure_risk,
  risk_level,
  retrieval_tags,
  variant_scope,
  priority,
  source_similarity_score,
  metadata
)
select
  rule_key,
  stage,
  sentence_role,
  role,
  funnel_stage,
  purpose,
  use_when,
  do_items,
  dont_items,
  rewrite_pattern,
  input_role_example,
  output_style_example,
  structure_risk,
  risk_level,
  retrieval_tags,
  variant_scope,
  priority,
  source_similarity_score,
  metadata
from rows
on conflict (rule_key) do update set
  stage = excluded.stage,
  sentence_role = excluded.sentence_role,
  role = excluded.role,
  funnel_stage = excluded.funnel_stage,
  purpose = excluded.purpose,
  use_when = excluded.use_when,
  do_items = excluded.do_items,
  dont_items = excluded.dont_items,
  rewrite_pattern = excluded.rewrite_pattern,
  input_role_example = excluded.input_role_example,
  output_style_example = excluded.output_style_example,
  structure_risk = excluded.structure_risk,
  risk_level = excluded.risk_level,
  retrieval_tags = excluded.retrieval_tags,
  variant_scope = excluded.variant_scope,
  priority = excluded.priority,
  source_similarity_score = excluded.source_similarity_score,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());
