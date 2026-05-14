create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists public.hook_templates (
  id uuid primary key default gen_random_uuid(),
  hook_code text not null unique,
  title text not null,
  hook_family text not null,
  template text not null,
  best_for text[] not null default '{}',
  emotions text[] not null default '{}',
  rewrite_rule text not null,
  search_text text not null default '',
  risk_note text not null default '',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists hook_templates_family_active_idx
  on public.hook_templates (hook_family, is_active);

create index if not exists hook_templates_best_for_gin_idx
  on public.hook_templates using gin (best_for);

create index if not exists hook_templates_emotions_gin_idx
  on public.hook_templates using gin (emotions);

drop trigger if exists set_hook_templates_updated_at on public.hook_templates;

create trigger set_hook_templates_updated_at
before update on public.hook_templates
for each row
execute function public.set_updated_at();

alter table public.hook_templates enable row level security;

drop policy if exists "Service role full access hook_templates"
on public.hook_templates;

create policy "Service role full access hook_templates"
on public.hook_templates
for all
to service_role
using (true)
with check (true);

create or replace function public.match_hook_templates(
  query_embedding vector(1536),
  match_count int default 6
)
returns table (
  id uuid,
  hook_code text,
  title text,
  hook_family text,
  best_for text[],
  emotions text[],
  rewrite_rule text,
  risk_note text,
  metadata jsonb,
  similarity double precision,
  final_rank double precision
)
language sql
stable
as $$
  with ranked as (
    select
      ht.*,
      1 - (ht.embedding <=> query_embedding) as similarity,
      1 - (ht.embedding <=> query_embedding) as final_rank
    from public.hook_templates ht
    where ht.embedding is not null
      and ht.is_active = true
  )
  select
    ranked.id,
    ranked.hook_code,
    ranked.title,
    ranked.hook_family,
    ranked.best_for,
    ranked.emotions,
    ranked.rewrite_rule,
    ranked.risk_note,
    ranked.metadata,
    ranked.similarity,
    ranked.final_rank
  from ranked
  order by ranked.final_rank desc
  limit least(greatest(match_count, 1), 8);
$$;

with raw(data) as (
  values ($hook_templates$[
    {"hook_code":"HOOK_01","title":"사소한 습관 경고형 훅","hook_family":"bad_habit_consequence","template":"평소 [타겟이 자주 하는 사소한 습관/행동 1]이나 [습관 2], [습관 3]을 자주 하면 [부정적인 결과 1] 되고, [가장 두려워하는 결과 2] 하는 상황이 생겨요.","best_for":["건강","운동","피부","자기관리","생활습관","정리정돈","육아","재테크 습관"],"emotions":["불안","위기감","뜨끔함","습관 점검"],"rewrite_rule":"타겟이 무심코 반복하는 행동을 2~3개 나열한 뒤, 그 행동이 만드는 부정적 결과를 구체적으로 연결한다.","search_text":"사소한 습관 잘못된 행동 계속하면 문제 생김 몸 망가짐 피부 나빠짐 정리 안됨 돈 새는 습관 생활습관 경고","risk_note":"건강/의학 관련 결과는 단정하지 말고 가능성 표현으로 완화할 것"},
    {"hook_code":"HOOK_02","title":"유명인/전문가 검증형 훅","hook_family":"authority_social_proof","template":"[유명인/전문가/지인]이 [놀라운 성과/목표]를 달성할 때 [사용했던 아이템/방법]인데, 이거 진짜 [간단함/편리함]에 비해 효과가 너무 좋아요.","best_for":["뷰티","다이어트","운동","생산성","공구","아이템 추천","전문가 팁"],"emotions":["신뢰","궁금증","따라 하고 싶음","검증된 느낌"],"rewrite_rule":"권위 있는 사람이나 주변인의 성과를 앞에 두고, 사용한 방법이 생각보다 간단하다는 점을 강조한다.","search_text":"유명인 전문가 지인 추천 검증된 방법 성과 달성 사용한 아이템 간단한데 효과 좋음 따라 산 제품","risk_note":"실제 근거 없는 유명인 이름, 의사/전문가 권위는 생성 금지"},
    {"hook_code":"HOOK_03","title":"시즌 임박 선점형 훅","hook_family":"seasonal_urgency","template":"여러분 그거 아세요? [시즌/상황] 닥쳐서 [아이템/서비스] 구하려면 [비싸고/재고 없고/이미 늦은 상황]이거든요. 그래서 미리 준비했습니다. [제품명/프로젝트명]!","best_for":["시즌 상품","공구","예약","이사","여름/겨울 대비","행사","선착순 판매"],"emotions":["조급함","놓치기 싫음","미리 준비","품절 불안"],"rewrite_rule":"시즌이 닥친 뒤에는 늦는다는 문제를 먼저 말하고, 미리 준비한 해결책을 제시한다.","search_text":"시즌 임박 여름 겨울 이사철 품절 가격 오름 예약 밀림 미리 준비 선착순 물량 확보 늦기 전에","risk_note":"실제 재고/가격/일정 정보가 없으면 단정 금지"},
    {"hook_code":"HOOK_04","title":"손해 볼 뻔한 경험담 훅","hook_family":"loss_aversion_story","template":"진짜 이거 [타겟 상황] 전에는 모르는 건데, 저 이번에 [구체적인 손해 금액/시간] 날릴 뻔했잖아요. 제가 오늘 [관련 장소/경험] 다녀와서 대충격을 받은 게...","best_for":["세금","이사","여행","사업","재테크","견적 비교","서비스 선택","생활 꿀팁"],"emotions":["손해 보기 싫음","긴장감","경험담","몰랐던 정보"],"rewrite_rule":"타겟이 겪을 수 있는 금전적/시간적 손해를 구체적 숫자로 제시하고, 직접 경험한 듯한 흐름으로 이어간다.","search_text":"손해 볼 뻔 돈 날릴 뻔 시간 날림 세금 더 냄 복비 항공권 견적 비교 모르면 손해 대충격 경험담","risk_note":"실제 손해 금액이 없으면 과도한 숫자 생성 금지"},
    {"hook_code":"HOOK_05","title":"성공 신호 리스트형 훅","hook_family":"positive_signal_list","template":"[주제/대상]이 잘 되고 있다는 결정적인 증거 [숫자]가지!","best_for":["퍼스널 브랜딩","다이어트","자기계발","재테크","성장","습관 개선","브랜드 운영"],"emotions":["확인 욕구","기대감","자가진단","성취감"],"rewrite_rule":"타겟이 자신의 상태를 점검하고 싶어 하도록 '잘 되고 있다는 증거' 형태로 리스트를 예고한다.","search_text":"잘 되고 있다는 증거 결정적인 신호 특징 리스트 성공 신호 성장하고 있음 체지방 빠짐 브랜딩 성공","risk_note":"성공/부자/건강 결과를 운명처럼 단정하지 말 것"},
    {"hook_code":"HOOK_06","title":"생돈 방지 혜택형 훅","hook_family":"saving_benefit","template":"요즘 누가 [타겟이 돈/시간 쓰는 일]에 생돈 다 써요? [주기/상황]에만 열리는 [혜택/지원금 이름], 지금 [현재 상태]니까요! 제가 바로 알려드릴게요.","best_for":["지원금","쿠폰","할인","캐시백","정부 혜택","생활비 절약","무료 기능","청년 혜택"],"emotions":["손해 보기 싫음","개이득","절약 욕구","놓치기 싫음"],"rewrite_rule":"제값을 내는 행동을 손해처럼 보이게 만들고, 바로 혜택/지원금/할인 정보를 제시한다.","search_text":"요즘 누가 제값 생돈 혜택 지원금 캐시백 쿠폰 할인 무료 돈 아끼기 생활비 절약 청년 문화패스","risk_note":"혜택/지원금은 반드시 최신 사실 확인 필요"},
    {"hook_code":"HOOK_07","title":"함부로 했다가 위험형 훅","hook_family":"risk_warning","template":"[아이템/앱] 함부로 [행동]했다가 이런 일이 벌어질 수도 있습니다. '너 [비밀/민망한 사실] 있어?'라고 연락 올 수도 있는 건데, 단순히 [사소한 행동]만 했을 뿐인데 왜 이런 정보가 뜨는 걸까요?","best_for":["보안","개인정보","피부","건강","앱 사용","소비자 주의","생활 경고"],"emotions":["공포","불안","호기심","주의 환기"],"rewrite_rule":"사소해 보이는 행동이 예상 못 한 문제로 이어질 수 있다는 반전 구조를 만든다.","search_text":"함부로 했다가 위험 개인정보 털림 피부 노화 보안 무료 와이파이 앱 권한 이상한 문자 조심","risk_note":"공포 조장은 과하지 않게, 실제 위험 근거가 없으면 완화"},
    {"hook_code":"HOOK_08","title":"고민 해결 리스트형 훅","hook_family":"problem_solution_list","template":"[주제/대상] 할 때 도움 되는 [숫자]가지! 보통 [타겟이 하는 고민] 때문에 조심해야 할 [관련 요소]들이 많은데요. 오늘은 [가장 얻고 싶은 결과]를 만들어주는 [숫자]가지 빠르게 알아볼게요.","best_for":["생활 꿀팁","뷰티 루틴","정리","청소","운동","콘텐츠 제작","초보자 가이드"],"emotions":["정리감","저장 욕구","기대감","문제 해결"],"rewrite_rule":"타겟의 고민을 먼저 공감하고, 해결 리스트를 빠르게 알려준다는 흐름으로 구성한다.","search_text":"도움 되는 가지 고민 해결 리스트 빠르게 알아보기 피부 속광 정리 집 넓어짐 버리기 리스트 초보자 팁","risk_note":"숫자는 실제 내용 개수와 맞출 것"},
    {"hook_code":"HOOK_09","title":"직접 써보고 엄선형 훅","hook_family":"curated_review","template":"[기간/횟수] 동안 [경험한 총합] 중에서 여기만큼은 무조건 가야/써야 한다! 광고 없고, 후회 없는 [타겟이 찾는 핵심 키워드], 딱 [숫자]곳만 뽑아봤습니다.","best_for":["제품 추천","툴 추천","책 추천","맛집","여행","화장품","앱 추천","리뷰 콘텐츠"],"emotions":["신뢰","시간 절약","후회 방지","찐후기"],"rewrite_rule":"많이 경험해본 사람의 엄선 리스트처럼 보이게 만들고, 광고 없음/후회 없음/딱 몇 개만이라는 필터링 가치를 강조한다.","search_text":"직접 써보고 엄선 광고 없음 찐후기 후회 없는 추천 딱 몇 개만 뽑음 AI툴 립스틱 책 맛집","risk_note":"실제로 써본 척하는 허위 경험은 피할 것"},
    {"hook_code":"HOOK_10","title":"단돈 가격 대비 경험형 훅","hook_family":"low_price_high_value","template":"단돈 [가격]이면 [누릴 수 있는 최고의 경험]을 할 수 있는 이곳! 과연 어디일까요?","best_for":["가성비 제품","장소 추천","카페","뷰티템","마케팅 서비스","체험형 콘텐츠"],"emotions":["호기심","가성비","기대감","클릭 욕구"],"rewrite_rule":"낮은 가격과 높은 경험 가치를 대비시키고, 마지막에 정답을 숨겨 궁금하게 만든다.","search_text":"단돈 가성비 저렴한 가격 최고의 경험 어디일까요 커피값 피부템 마케팅 효과 국내 카페 장소 추천","risk_note":"가격이 실제와 다르면 사용 금지"},
    {"hook_code":"HOOK_11","title":"저장 유도 개이득형 훅","hook_family":"save_this_benefit","template":"여러분, [활동/상황] 하기 전에 저장해두면 무조건 개이득인 [혜택/정보] 아직도 모르시나요? [아이템/장소]에서 [누리는 결과] 하는 법, 지금 바로 알려드릴게요.","best_for":["꿀팁","무료 혜택","지원금","취업","AI툴","쇼핑","생활 정보","저장 유도 콘텐츠"],"emotions":["저장 욕구","놓치기 싫음","혜택 기대","정보 소유감"],"rewrite_rule":"저장해야 할 이유를 먼저 만들고, 타겟이 얻을 혜택을 바로 예고한다.","search_text":"저장해두면 개이득 아직도 모르시나요 무료 기능 혜택 정보 공짜 수강료 환급 명품 화장품 취업 준비","risk_note":"무조건이라는 표현은 과장될 수 있으니 필요시 완화"},
    {"hook_code":"HOOK_12","title":"어디 거냐 질문 폭주형 훅","hook_family":"asked_many_times","template":"'어디 거냐'고 하루에도 수십 번 질문받은 [내 공간/아이템 카테고리]! 오늘 제가 쓰는 [아이템들] 싹 정리해 드릴게요.","best_for":["인테리어","작업실","주방템","뷰티템","전문가 애착템","공구","라이프스타일"],"emotions":["궁금증","검증된 느낌","따라 사고 싶음","소유 욕구"],"rewrite_rule":"주변에서 많이 물어본다는 사회적 증거를 만들고, 사용하는 아이템을 정리해준다는 흐름으로 간다.","search_text":"어디 거냐 질문받은 아이템 애착템 작업실템 주방템 원장님 추천 플로리스트 생산성 꿀템 집들이","risk_note":"실제로 질문받은 경험이 없으면 '많이들 궁금해하시는' 정도로 완화"},
    {"hook_code":"HOOK_13","title":"아직도 이렇게 하세요 반박형 훅","hook_family":"old_way_challenge","template":"아직도 [아이템/행동] 할 때 이렇게 하신다고요?! 그건 [부정적인 이미지/결과]로 가는 지름길이에요.","best_for":["튜토리얼","자기소개","사진 포즈","콘텐츠 제작","뷰티","운동","업무 방식 개선"],"emotions":["뜨끔함","반박 욕구","문제 인식","개선 욕구"],"rewrite_rule":"타겟의 기존 방식을 지적하고, 그 방식이 초래하는 부정적 이미지를 짧고 강하게 제시한다.","search_text":"아직도 이렇게 하신다고요 잘못된 방식 지름길 어색해 보임 비율 안 좋아 보임 지루함 개선 필요","risk_note":"비난처럼 들리지 않게 타겟 톤에 맞게 강도 조절"},
    {"hook_code":"HOOK_14","title":"전문가 추천 필수템 훅","hook_family":"expert_recommendation","template":"[직업/경력]이 추천하는 [시즌/테마] 필수템! [고민/상황] 때문에 뭐 살지/쓸지 모르겠다? 그럼 무조건 이거 보세요.","best_for":["전문가 추천","시즌템","입문자 가이드","구매 가이드","편의점템","통장 추천","운동템"],"emotions":["신뢰","선택 피로 감소","전문가 도움","필수템 기대"],"rewrite_rule":"전문가/경력자의 관점으로 선택지를 줄여주고, 고민 중인 사람에게 바로 볼 이유를 준다.","search_text":"전문가 추천 필수템 뭐 살지 모르겠다 전직 은행원 트레이너 편의점 다이어트템 사회초년생 통장","risk_note":"전문가 자격이 허위이면 사용 금지"},
    {"hook_code":"HOOK_15","title":"열심히 하는데 결과 없음 의심형 훅","hook_family":"effort_not_working","template":"[주제/활동] 열심히 하는데 [원하는 결과] 안 나오신다고요? 제대로 하는 거 맞아요?","best_for":["운동","다이어트","피부관리","콘텐츠 제작","공부","마케팅","루틴 개선"],"emotions":["뜨끔함","의심","문제 점검","개선 욕구"],"rewrite_rule":"노력은 하고 있지만 결과가 안 나는 타겟에게 방법 자체를 점검하게 만든다.","search_text":"열심히 하는데 결과 안 나옴 제대로 하는 거 맞아요 운동 살 안 빠짐 화장품 피부 안 좋아짐 콘텐츠 조회수","risk_note":"사용자를 무시하는 느낌이 나지 않게 부드럽게 조정 가능"},
    {"hook_code":"HOOK_16","title":"의외의 사용법 검증형 훅","hook_family":"unexpected_usage_trend","template":"[아이템]으로 [의외의 행동/부위]를 하시는 거 보셨어요? 요즘 [커뮤니티/플랫폼]에서 가장 핫한 [고민 해결법]이라고 해서 따라 해봤는데요.","best_for":["SNS 트렌드","생활 꿀팁","뷰티 hacks","AI툴","앱 활용","실험 콘텐츠"],"emotions":["신기함","호기심","트렌드감","따라 해보고 싶음"],"rewrite_rule":"익숙한 아이템의 낯선 사용법을 제시하고, 요즘 뜨는 방법이라 직접 해봤다는 흐름을 만든다.","search_text":"의외의 사용법 요즘 핫한 커뮤니티 트렌드 따라 해봤다 메모장 앱 대본 바셀린 블랙헤드 SNS 꿀팁","risk_note":"위험한 민간요법/피부 실험은 안전 주의 필요"},
    {"hook_code":"HOOK_17","title":"10초 해결 즉시성 훅","hook_family":"quick_fix","template":"[고민되는 부분/문제] 10초 만에 확실하게 해결하는 법! 의외로 많은 분이 모르시더라고요. 일단 [아이템/방법]으로 한번 [기초 행동]을 해주세요.","best_for":["빠른 꿀팁","청소","정리","콘텐츠 수정","디자인 수정","업무 효율","생활 문제 해결"],"emotions":["즉시성","쉬움","해결 기대","몰랐던 팁"],"rewrite_rule":"문제를 매우 짧은 시간 안에 해결할 수 있다는 기대를 주고, 첫 행동을 간단하게 제시한다.","search_text":"10초 만에 해결 빠른 해결법 의외로 모름 일단 해주세요 릴스 살리기 수납공간 좁은 옷장 청소","risk_note":"진짜 10초 해결이 아니면 '빠르게'로 완화"},
    {"hook_code":"HOOK_18","title":"업계가 싫어할 비법형 훅","hook_family":"insider_secret","template":"[내 사업/직업] 망할 각오하고 알려드리는 [주제/해결책] 비법! 딱 한번, 단돈 [낮은 가격]이면 충분해요.","best_for":["홈케어","청소","수리","뷰티","전문가 노하우","돈 아끼는 팁","생활 비법"],"emotions":["비밀스러움","가성비","전문가 내부 정보","저장 욕구"],"rewrite_rule":"업계 사람이 손해 볼 정도의 내부 비법처럼 포장하고, 적은 비용/간단한 방법으로 해결된다는 점을 강조한다.","search_text":"망할 각오 알려드림 업계 비밀 전문가 비법 홈케어 세탁소 사장님 싫어할 단돈 저렴한 해결법","risk_note":"과도한 내부자/업계 비하 표현은 브랜드 톤에 맞게 조절"},
    {"hook_code":"HOOK_19","title":"초단기 정보 전달형 훅","hook_family":"fast_answer","template":"[타겟 상황] [가장 궁금해할 정보] 하는 법! [숫자]초 안에 싹 알려드림.","best_for":["짧은 튜토리얼","초보자 정보","신청 방법","설정 방법","앱 사용법","꿀팁 요약"],"emotions":["빠름","간결함","정보 기대","즉시 이해"],"rewrite_rule":"타겟이 지금 당장 알고 싶은 방법을 제목처럼 제시하고, 짧은 시간 안에 알려준다고 약속한다.","search_text":"하는 법 몇 초 안에 알려드림 빠르게 요약 신청 방법 설정 방법 사용법 초보자 가이드 싹 알려드림","risk_note":"실제 영상 길이/정보량과 맞춰 숫자 조정"},
    {"hook_code":"HOOK_20","title":"긍정적 변화 증거형 훅","hook_family":"positive_result_signal","template":"[주제/대상]이 [긍정적인 결과] 되었다는 결정적인 증거 [숫자]가지!","best_for":["피부","건강","성장","재테크","자기계발","운동","습관 개선"],"emotions":["확인 욕구","희망","성장감","자가진단"],"rewrite_rule":"타겟이 원하는 긍정적 변화가 실제로 일어나고 있는지 확인하게 만드는 리스트형 훅이다.","search_text":"긍정적인 결과 결정적인 증거 회복 성공 변화 신호 피부 장벽 복구 부자 될 사람 특징 성장 신호","risk_note":"건강/부자/성공 관련 단정 표현은 조심"},
    {"hook_code":"HOOK_21","title":"물건 변형 천재형 훅","hook_family":"object_hack_curiosity","template":"[아이템]의 [특정 부위]를 [행동] 하면 [타겟] 천재가 됩니다. 뭐지? 싶으시죠?","best_for":["생활 해킹","재활용","DIY","정리","주방 꿀팁","뷰티 도구","육아 놀이"],"emotions":["신기함","호기심","재활용 만족","따라 하고 싶음"],"rewrite_rule":"평범한 물건의 특정 부위를 변형하면 전혀 다른 문제 해결 도구가 된다는 반전 구조를 만든다.","search_text":"아이템 부위 자르면 천재 됩니다 뭐지 싶으시죠 재활용 DIY 생활 해킹 공병 뚜껑 빨대 주방 정리","risk_note":"위험한 절단/개조는 안전 주의 필요"},
    {"hook_code":"HOOK_22","title":"주변인이 따라 산 반전형 훅","hook_family":"peer_imitation_reverse_target","template":"제가 [사용/추천]하는 거 보고 [주변인/지인]이 바로 따라 산 [플랫폼] [아이템/카테고리] [숫자]가지! 이건 분명 [원래 타겟/용도]인데, [의외의 타겟/반전 상황]이 더 좋아하시는 것 같아요.","best_for":["제품 추천","앱 추천","육아템","업무툴","공구","생활템","반전 타겟"],"emotions":["사회적 증거","궁금증","반전","따라 사고 싶음"],"rewrite_rule":"내가 쓰는 걸 보고 주변인이 따라 샀다는 사회적 증거를 만들고, 원래 용도와 실제 좋아하는 타겟의 반전을 준다.","search_text":"제가 쓰는 거 보고 따라 산 아이템 앱 업무용 꿀앱 쿠팡 육아템 원래는 아이용인데 아빠가 좋아함 반전","risk_note":"허위 구매 후기처럼 보이지 않게 실제 근거가 없으면 표현 완화"},
    {"hook_code":"HOOK_23","title":"세상에 충격 사건형 훅","hook_family":"shock_incident_story","template":"세상에! 이게 이렇게 된다고? 저 [기간] 동안 이거 붙잡고 있었어요... [사건의 발단] 때문에 생긴 [문제 상황]!","best_for":["문제 해결","실패담","피부 트러블","청소","육아","생활 사고","후기형 콘텐츠"],"emotions":["충격","공감","당황","문제 해결 기대"],"rewrite_rule":"예상 못 한 문제 상황을 감정적으로 열고, 기간과 사건의 발단을 넣어 스토리 몰입을 만든다.","search_text":"세상에 이렇게 된다고 충격 문제 상황 붙잡고 있었어요 피부 뒤집힘 유성매직 벽화 사고 실패담","risk_note":"질병/피부 문제는 과장된 공포 표현 주의"},
    {"hook_code":"HOOK_24","title":"200% 활용법 훅","hook_family":"maximize_usage","template":"[아이템] 200% 활용해서 [원하는 결과] 높이는 법, 제가 바로 알려드릴게요!","best_for":["툴 활용","앱 활용","노션","화장품","생활템","생산성","콘텐츠 기획"],"emotions":["효율","활용 욕구","기대감","배우고 싶음"],"rewrite_rule":"이미 알고 있는 아이템을 더 잘 쓰는 방법을 알려준다는 구조로, 결과 향상을 명확히 제시한다.","search_text":"200% 활용 활용법 효율 높이는 법 노션 콘텐츠 기획 속도 생산성 화장솜 피부 아이템 잘 쓰는 법","risk_note":"효과 수치가 과장되지 않게 조정"},
    {"hook_code":"HOOK_25","title":"비용/노력 절약 대체법 훅","hook_family":"save_money_without_old_method","template":"나만 알고 싶은 [목표 결과] 하는 법! [조건/도구] 없이 [아끼는 금액/시간] 버는/아끼는 법 알려드릴게요. [기존의 힘든 방식] 안 해도 [목표 결과]를 얻을 수 있다고?","best_for":["돈 아끼기","시간 절약","뷰티","식단","가사","생산성","대체 방법"],"emotions":["개이득","해방감","절약","놀라움"],"rewrite_rule":"기존에 돈/시간/노력이 많이 들던 방식을 대체할 수 있다는 메시지로 시작한다.","search_text":"나만 알고 싶은 돈 아끼는 법 시간 절약 비싼 레이저 없이 피부과 안 가고 식비 절약 불 안 쓰고 대체법","risk_note":"의학/피부과 대체 표현은 효과 보장처럼 쓰지 말 것"},
    {"hook_code":"HOOK_26","title":"귀찮은 과정 초간단 대체형 훅","hook_family":"easy_alternative_to_annoying_process","template":"[메뉴/작업] 한 번 하려면 [복잡한 과정]... 너무 귀찮잖아요! 제가 하는 방법은 초간단인데 너무 [결과] [대상]이 [긍정적 반응] 하는 [메뉴/비법]이에요!","best_for":["요리","청소","세탁","뷰티","아침 준비","가사","루틴 단축"],"emotions":["귀찮음 해소","간편함","효율","만족감"],"rewrite_rule":"기존 과정의 귀찮음을 구체적으로 묘사한 뒤, 훨씬 간단한 대체법을 제시한다.","search_text":"귀찮잖아요 초간단 방법 이중세안 줄눈청소 다리미 예열 주름 펴기 가사 루틴 간편 비법","risk_note":"결과가 과장되지 않게 실제 수준에 맞출 것"},
    {"hook_code":"HOOK_27","title":"진짜 충격적이게 좋았던 발견형 훅","hook_family":"surprising_discovery_story","template":"아니 글쎄 제가 [지역명/상황]에서 진짜 충격적이게 [좋았던/맛있었던/효과 좋았던] [장소/방법/아이템]이 하나 있는데! 하루 [제한 조건]밖에 안 하지만 [타겟/전문가]들도 굳이 찾아가서 [행동]한다는 [대상] 다녀왔어요.","best_for":["맛집","샵 후기","기획법","콘텐츠 팁","전문가 추천 장소","로컬 추천","숨은 발견"],"emotions":["흥분","발견감","희소성","전문가도 찾는 느낌"],"rewrite_rule":"우연히 발견한 강력한 경험처럼 열고, 제한 조건과 전문가/현지인도 찾는다는 신뢰를 붙인다.","search_text":"아니 글쎄 진짜 충격적으로 좋았던 장소 방법 하루 딱 제한 상위 1% 전문가도 굳이 찾아 쓰는 샵 맛집","risk_note":"전문가/상위 1% 표현은 근거 없으면 완화"},
    {"hook_code":"HOOK_28","title":"추천받고 재방문형 훅","hook_family":"recommended_repeat_use","template":"아니 여기 [추천 출처] 추천으로 왔다가! 제가 또또또 방문했던 곳인데, 위치는 [위치 정보 예고]에 적어둘게요.","best_for":["장소 추천","샵 후기","맛집","청소법","생활템","서비스 후기","재구매 콘텐츠"],"emotions":["신뢰","재방문 욕구","찐후기","추천받은 느낌"],"rewrite_rule":"누군가의 추천으로 시작했다가 반복해서 쓰거나 방문하게 됐다는 중독성/만족감을 강조한다.","search_text":"추천으로 왔다가 또또또 방문 재방문 일 년째 쓰는 방법 모델 친구 추천 입주 청소 사장님 추천 찐후기","risk_note":"실제 추천 출처가 없으면 '지인 추천처럼 알려진' 식으로 조정"},
    {"hook_code":"HOOK_29","title":"비포애프터 확실한 꿀템형 훅","hook_family":"before_after_proof","template":"비포 애프터가 확실한 [카테고리] 꿀템 [숫자]가지! 이거 효과 대박이에요. [전문가/관련 업체]에서도 쓰고 요즘 핫하대서 써봤는데!","best_for":["뷰티","청소","육아템","세탁","정리","제품 추천","홈케어"],"emotions":["효과 기대","검증감","비교 욕구","따라 사고 싶음"],"rewrite_rule":"전후 차이가 분명하다는 점을 앞세우고, 전문가/업계에서도 쓴다는 신뢰감을 붙인다.","search_text":"비포 애프터 확실한 꿀템 효과 대박 전문가도 쓰는 핫한 제품 피부결 홈케어 유모차 카시트 세탁","risk_note":"효과 보장/전문가 사용 여부는 근거 없으면 완화"},
    {"hook_code":"HOOK_30","title":"기존 방식 대신 이렇게 해보세요 훅","hook_family":"simple_replacement","template":"[기존 행동/음식] 대신 이렇게 [새로운 방식] 해보세요! 너무 간단해서 저 요즘 매일 이것만 [하고/먹고] 있어요.","best_for":["생활 대체법","뷰티","세탁","청소","식단","루틴","초간단 팁"],"emotions":["간단함","따라 하기 쉬움","대체 욕구","일상성"],"rewrite_rule":"기존에 하던 방식을 가볍게 바꾸도록 제안하고, 너무 쉬워서 매일 하게 된다는 반복성을 강조한다.","search_text":"대신 이렇게 해보세요 너무 간단 매일 이것만 비싼 팩 대신 섬유유연제 대신 빨래 루틴 대체법","risk_note":"매일 사용이 부적절한 제품/방법은 빈도 표현 조정"}
  ]$hook_templates$::jsonb)
), rows as (
  select
    item->>'hook_code' as hook_code,
    item->>'title' as title,
    item->>'hook_family' as hook_family,
    item->>'template' as template,
    array(select jsonb_array_elements_text(item->'best_for')) as best_for,
    array(select jsonb_array_elements_text(item->'emotions')) as emotions,
    item->>'rewrite_rule' as rewrite_rule,
    item->>'search_text' as search_text,
    item->>'risk_note' as risk_note,
    jsonb_build_object(
      'source', 'seed_hook_templates_v1',
      'template_stored', true,
      'examples_stored', false,
      'urls_stored', false
    ) as metadata
  from raw, jsonb_array_elements(data) as item
)
insert into public.hook_templates (
  hook_code,
  title,
  hook_family,
  template,
  best_for,
  emotions,
  rewrite_rule,
  search_text,
  risk_note,
  metadata
)
select
  hook_code,
  title,
  hook_family,
  template,
  best_for,
  emotions,
  rewrite_rule,
  search_text,
  risk_note,
  metadata
from rows
on conflict (hook_code) do update set
  title = excluded.title,
  hook_family = excluded.hook_family,
  template = excluded.template,
  best_for = excluded.best_for,
  emotions = excluded.emotions,
  rewrite_rule = excluded.rewrite_rule,
  search_text = excluded.search_text,
  risk_note = excluded.risk_note,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());
