create table if not exists public.caption_category_rules (
  id uuid primary key default gen_random_uuid(),
  category text unique not null,
  core text not null,
  winning_features text[] not null default '{}',
  hook_patterns text[] not null default '{}',
  caption_flow text[] not null default '{}',
  cta_patterns text[] not null default '{}',
  banned_expressions text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_caption_category_rules_updated_at on public.caption_category_rules;

create trigger set_caption_category_rules_updated_at
before update on public.caption_category_rules
for each row
execute function public.set_updated_at();

with raw(data) as (
  values ($$[
    {"category":"운동/헬스","core":"초보 문제 진단 + 안전한 실천 기준","winning_features":["초보자가 흔히 하는 실수를 먼저 짚기","루틴/자세/회복 기준 제시","체형 변화 보장 대신 실천 기준 설명","추천/비추천 대상 구분","운동 전 저장할 체크리스트 제공"],"hook_patterns":["운동해도 몸이 그대로라면 루틴보다 먼저 봐야 할 게 있습니다.","헬스 초보가 제일 먼저 놓치는 건 무게가 아니라 순서입니다.","운동 효과가 안 나는 사람은 이 기준부터 확인하세요.","초보라면 맨손만 고집하지 마세요."],"caption_flow":["초보 운동 고민","흔한 실수","루틴/자세 기준","추천/비추천 대상","저장/링크 CTA"],"cta_patterns":["운동 전 체크용으로 저장해두세요.","루틴 정보는 프로필 링크에서 확인하세요.","비슷한 고민 있으면 댓글로 남겨주세요."],"banned_expressions":["무조건 빠진다","2주 완성","효과 보장","감량 보장","근성장 보장"]},
    {"category":"뷰티","core":"고민 공감 + 피부 타입별 기준","winning_features":["피부/메이크업 고민 먼저 공감","피부 타입과 사용 순서 기준 제시","사용감과 아쉬운 점 함께 설명","효능 단정 피하기","루틴 저장형 구성"],"hook_patterns":["화장품을 바꿔도 피부가 그대로라면 순서부터 확인해보세요.","좋다는 제품을 써도 안 맞는 이유는 따로 있습니다.","피부 고민이 반복된다면 제품보다 기준을 먼저 봐야 합니다.","이 루틴은 모두에게 맞는 정답이 아닙니다."],"caption_flow":["피부/메이크업 고민","흔한 실수","타입별 기준","사용감/장단점","저장/링크 CTA"],"cta_patterns":["루틴 전에 저장해두세요.","제품 정보는 프로필 링크에 정리해둘게요.","내 피부 타입에 맞는지 한 번 더 확인해보세요."],"banned_expressions":["치료","완치","효과 보장","무조건 좋아짐","피부 개선 보장"]},
    {"category":"살림","core":"생활 문제 해결 + 시간 절약","winning_features":["반복되는 집안 문제 먼저 제시","정리/청소/보관 기준 제공","사용 전후 상황 보여주기","모든 집에 통하는 정답처럼 말하지 않기","저장형 체크리스트 제공"],"hook_patterns":["집이 금방 어지러워진다면 물건보다 동선이 문제일 수 있어요.","살림템은 많이 사는 것보다 기준이 먼저입니다.","청소를 해도 금방 원래대로 돌아가는 이유","이건 우리 집에서 계속 쓰게 된 살림 기준입니다."],"caption_flow":["살림 고민","흔한 실수","해결 기준","사용 전후","저장/링크 CTA"],"cta_patterns":["살림템 구매 전 저장해두세요.","청소 전에 체크리스트로 확인하세요.","제품 정보는 프로필 링크에 정리해둘게요."],"banned_expressions":["무조건 해결","살림 필수템 단정","최저가 보장","완벽 해결","안 사면 손해"]},
    {"category":"육아","core":"정보보다 공감 + 안전성","winning_features":["부모의 죄책감/불안/피로를 먼저 공감","우리 집 기준으로 말하기","아이마다 다를 수 있음을 인정","실사용 상황을 구체적으로 보여주기","과장된 효과 표현 피하기"],"hook_patterns":["육아템은 많을수록 좋은 줄 알았는데 아니었어요.","아이를 위해 샀는데, 사실 제가 더 편해졌습니다.","초보 부모가 육아템 사기 전에 꼭 봐야 할 기준","이거 하나로 육아가 끝난다는 말은 믿지 마세요."],"caption_flow":["부모 공감","실제 상황","써보며 느낀 기준","장점/단점","아이마다 다를 수 있음","저장/공유 CTA"],"cta_patterns":["구매 전 체크리스트로 저장해두세요.","육아 중인 친구에게 공유해 주세요.","아이 상황에 맞는지 한 번 더 확인해보세요."],"banned_expressions":["아이 바로 잠듭니다","발달 보장","엄마라면 무조건 사야 함","육아 끝","안 사면 손해"]},
    {"category":"반려동물","core":"우리 아이 기준","winning_features":["보호자 시점으로 말하기","반려동물 반응 중심으로 작성","성향별 추천/비추천 구분","건강·질병 관련 단정 금지","우리 아이는 이렇게 반응했다는 관찰형 문장 사용"],"hook_patterns":["강아지가 싫어하는 줄 알았는데, 방식이 문제였어요.","고양이가 안 쓰는 물건에는 이유가 있었습니다.","반려동물 용품 사기 전에 이건 꼭 봐야 합니다.","우리 집에서 계속 쓰게 된 이유는 따로 있었어요."],"caption_flow":["보호자 고민","반려동물 반응","사용 방식/기준","장점/단점","성향별 추천","반려인 공유 CTA"],"cta_patterns":["반려인 친구에게 보내주세요.","구매 전 우리 아이 성향에 맞는지 저장해두세요.","비슷한 고민 있으면 댓글로 남겨주세요."],"banned_expressions":["무조건 좋아합니다","질병 치료","수의사 필요 없음","100% 적응","효과 확실"]},
    {"category":"자기계발","core":"감정 + 깨달음 + 실행 가능성","winning_features":["실패담으로 시작","과한 동기부여보다 현실적 깨달음","작은 실행 하나 제안","저장할 만한 루틴/체크리스트 제공","나도 그랬다는 톤 사용"],"hook_patterns":["열심히 사는데 계속 제자리였던 이유를 이제야 알았어요.","계획을 많이 세워도 변하지 않았던 이유","무기력할 때 제일 먼저 바꿔야 하는 건 이거였습니다.","성공한 사람보다 꾸준한 사람이 먼저 하는 것"],"caption_flow":["내 실패/공감","잘못 알고 있던 점","깨달음","작은 실천법","저장/댓글 CTA"],"cta_patterns":["혼자 보기 아까우면 저장해두세요.","오늘 하나만 실천해보세요.","루틴표가 필요하면 댓글에 '루틴' 남겨주세요."],"banned_expressions":["무조건 성공","인생 역전 보장","월 천 가능","게으르면 답 없음","이렇게 하면 무조건 바뀜"]},
    {"category":"패션","core":"체형/상황 적용성","winning_features":["체형/상황/계절 기준 제시","코디 조합 보여주기","실패 줄이는 구매 기준","사이즈 팁 제공","외모 비하 금지"],"hook_patterns":["옷을 많이 사도 입을 게 없는 이유는 이거였어요.","비싼 옷보다 먼저 봐야 하는 건 핏입니다.","유행템을 사도 어색한 사람은 이걸 확인하세요.","옷 잘 입는 사람은 아이템보다 조합을 먼저 봅니다."],"caption_flow":["옷장/코디 고민","흔한 실수","체형/상황별 기준","코디 예시","저장/링크 CTA"],"cta_patterns":["코디 정보는 저장해두세요.","비슷한 체형 친구에게 보내주세요.","제품 정보는 프로필 링크에 정리해둘게요."],"banned_expressions":["이 체형은 절대 입지 마세요","뚱뚱해 보이면 실패","무조건 사야 함","남자/여자 무조건 좋아함","인생핏 보장"]},
    {"category":"AI","core":"시간 단축 + 전후 비교","winning_features":["전후 비교","프롬프트 구조 제시","실제 업무 사례","시간 단축 수치","초보자가 바로 따라 할 수 있는 순서"],"hook_patterns":["이 프롬프트 하나로 캡션 쓰는 시간이 30분 줄었습니다.","AI를 써도 결과가 별로인 이유는 질문이 애매해서입니다.","콘텐츠 만들 때 이 순서로 물어보면 결과가 달라집니다.","AI 초보가 제일 먼저 저장해야 하는 프롬프트입니다."],"caption_flow":["AI 사용 실패","문제 원인","프롬프트/순서 제시","결과 차이","댓글 키워드/저장 CTA"],"cta_patterns":["댓글에 '프롬프트' 남기면 정리본 보내드릴게요.","업무에 써볼 분들은 저장해두세요.","AI 자동화가 필요하면 DM 주세요."],"banned_expressions":["AI 하나면 끝","자동으로 돈 벌립니다","100% 자동화","사람 필요 없음","무조건 결과 좋아짐"]},
    {"category":"재테크","core":"습관 + 신뢰","winning_features":["돈 습관 중심","절약 루틴","초보 실수","월급 관리 순서","투자 판단 대신 생활 금융 중심"],"hook_patterns":["돈을 못 모으는 이유는 월급이 적어서만은 아니었어요.","재테크 초보가 제일 먼저 버려야 하는 습관","돈이 새는 사람은 소비 전에 이걸 안 봅니다.","투자보다 먼저 해야 할 돈 관리 순서"],"caption_flow":["돈 고민","흔한 착각","돈 새는 지점","체크리스트","저장 CTA"],"cta_patterns":["투자 판단 말고 돈 습관 점검용으로 저장하세요.","가계부 시작 전 저장해두세요.","비슷한 고민 있는 친구에게 공유해 주세요."],"banned_expressions":["무조건 오릅니다","수익 보장","이 종목 사세요","한 달 만에 부자","원금 보장","손실 없음"]},
    {"category":"여행","core":"실수 방지 + 저장","winning_features":["여행 전 체크리스트","일정표","예산 정리","현지 실수 방지","같이 가는 친구에게 공유하고 싶은 정보"],"hook_patterns":["이걸 몰라서 여행 첫날부터 돈을 날렸습니다.","여행 가기 전에 이 체크리스트는 꼭 저장하세요.","예쁜 여행보다 덜 고생하는 여행이 먼저입니다.","숙소 예약 전에 이 3가지는 꼭 봐야 합니다."],"caption_flow":["여행 실수","왜 문제였는지","체크리스트/동선/예산","저장/친구 공유 CTA"],"cta_patterns":["여행 가기 전 저장해두세요.","같이 여행 가는 친구에게 보내주세요.","준비물 정보는 프로필 링크에 정리해둘게요."],"banned_expressions":["무조건 최저가","절대 실패 없음","여기 안 가면 손해","평생 최저가","100% 만족 여행"]},
    {"category":"요리","core":"간단함 + 실패 방지","winning_features":["5분 레시피","실패 없는 비율","재료 대체","냉장고 털이","오늘 저녁 메뉴로 저장"],"hook_patterns":["이 비율만 알면 김치볶음밥이 갑자기 맛있어집니다.","요리가 어려운 게 아니라 순서가 복잡했던 거예요.","냉장고에 남은 재료로 이건 꼭 해보세요.","맛이 안 나는 이유는 재료보다 비율이었습니다."],"caption_flow":["요리 실패/귀찮음","핵심 비율/순서","대체 재료","주의점","저장 CTA"],"cta_patterns":["오늘 저녁 메뉴로 저장해두세요.","요리 초보 친구에게 보내주세요.","재료 정보는 프로필 링크에 정리해둘게요."],"banned_expressions":["이거 먹으면 건강 해결","다이어트 보장","무조건 맛있음","실패 절대 없음","만병통치"]},
    {"category":"테크 가젯","core":"구매 기준 + 비교","winning_features":["구매 전 체크리스트","장단점 비교","추천/비추천 대상","가격 대비 활용도","실사용 맥락"],"hook_patterns":["비싼 가젯을 사기 전에 이 3가지는 꼭 보세요.","스펙보다 중요한 건 내가 실제로 쓰는 기능입니다.","이 제품은 모두에게 좋은 제품은 아닙니다.","구매 후회 줄이려면 이 기준부터 보세요."],"caption_flow":["구매 고민","스펙보다 중요한 기준","장점/단점","추천/비추천 대상","링크/저장 CTA"],"cta_patterns":["구매 전 체크리스트로 저장하세요.","제품 정보는 프로필 링크에 정리해둘게요.","내 사용 목적에 맞는지 확인해보세요."],"banned_expressions":["무조건 사세요","역대급 가성비 확정","단점 없음","모두에게 필수","이거 하나면 끝"]},
    {"category":"멘탈케어","core":"안전한 공감","winning_features":["감정 이름 붙이기","자기비난 줄이기","번아웃 체크리스트","자기돌봄 루틴","부드러운 문장"],"hook_patterns":["괜찮은 척하는 사람일수록 이 말에 무너집니다.","쉬어도 회복이 안 되는 날에는 이걸 먼저 봐야 합니다.","내가 예민한 게 아니라 너무 오래 참은 걸 수도 있습니다.","마음이 지친 사람은 계획보다 회복이 먼저입니다."],"caption_flow":["감정 공감","나를 탓하지 않게 하기","작은 자기돌봄","전문가 도움 가능성","공유/저장 CTA"],"cta_patterns":["오늘 마음이 무거운 사람에게 보내주세요.","혼자 보기 아까우면 저장해두세요.","오늘 밤 자기 전에 한 줄만 적어보세요."],"banned_expressions":["우울증 치료","상담 필요 없음","이것만 하면 회복","멘탈 완치","무조건 괜찮아짐","약 안 먹어도 됨"]},
    {"category":"교육","core":"문제 진단 + 순서","winning_features":["공부 순서","복습 루틴","시험 전 체크리스트","학부모 팁","자료 요청 CTA"],"hook_patterns":["공부를 못하는 게 아니라, 복습 순서가 틀렸을 수 있어요.","성적이 안 오르는 학생들이 자주 놓치는 것","학부모가 공부보다 먼저 봐야 할 건 이겁니다.","문제를 많이 풀어도 틀리는 이유는 따로 있습니다."],"caption_flow":["학생/학부모 고민","원인 진단","공부 순서","체크리스트","저장/자료 요청 CTA"],"cta_patterns":["아이 공부 루틴 점검용으로 저장하세요.","공부 중인 친구에게 보내주세요.","정리본이 필요하면 댓글에 '자료' 남겨주세요."],"banned_expressions":["무조건 성적 오름","합격 보장","이렇게 안 하면 망함","공부 못하는 아이 특징","100점 보장"]}
  ]$$::jsonb)
),
rows as (
  select
    item->>'category' as category,
    item->>'core' as core,
    array(select jsonb_array_elements_text(item->'winning_features')) as winning_features,
    array(select jsonb_array_elements_text(item->'hook_patterns')) as hook_patterns,
    array(select jsonb_array_elements_text(item->'caption_flow')) as caption_flow,
    array(select jsonb_array_elements_text(item->'cta_patterns')) as cta_patterns,
    array(select jsonb_array_elements_text(item->'banned_expressions')) as banned_expressions
  from raw, jsonb_array_elements(data) as item
)
insert into public.caption_category_rules (
  category,
  core,
  winning_features,
  hook_patterns,
  caption_flow,
  cta_patterns,
  banned_expressions
)
select
  category,
  core,
  winning_features,
  hook_patterns,
  caption_flow,
  cta_patterns,
  banned_expressions
from rows
on conflict (category) do update set
  core = excluded.core,
  winning_features = excluded.winning_features,
  hook_patterns = excluded.hook_patterns,
  caption_flow = excluded.caption_flow,
  cta_patterns = excluded.cta_patterns,
  banned_expressions = excluded.banned_expressions,
  updated_at = timezone('utc', now());
