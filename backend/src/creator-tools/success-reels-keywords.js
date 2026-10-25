// Search seeds for the daily success-reels collection. The collector only uses these
// to find candidate accounts; categories are always decided by the account review.
// Edit here to change what the Mac mini searches; no collector reinstall is needed.
export const SUCCESS_REEL_KEYWORDS = [
  { category: '피부', domestic: ['피부관리', '여드름 관리', '모공 관리', '스킨케어 루틴', '피부과 시술'], overseas: ['skincare routine', 'acne tips'] },
  { category: '뷰티', domestic: ['메이크업 꿀팁', '다이소 뷰티템', '올리브영 추천', '헤어 스타일링', '네일'], overseas: ['makeup tips', 'hair tutorial'] },
  { category: '먹방', domestic: ['먹방', '맛집 추천', '편의점 신상', '디저트 맛집', '대식가'], overseas: ['food review', 'mukbang'] },
  { category: '일상', domestic: ['일상 브이로그', '자취 일상', '직장인 브이로그', '주말 루틴', '모닝루틴'], overseas: ['day in my life', 'morning routine'] },
  { category: '육아', domestic: ['육아꿀팁', '육아템', '아기 이유식', '육아 브이로그', '엄마표 놀이'], overseas: ['parenting hacks', 'mom life'] },
  { category: '살림', domestic: ['살림꿀팁', '정리수납', '청소 꿀팁', '자취 살림', '주방 살림템'], overseas: ['cleaning hacks', 'home organization'] },
  { category: '요리', domestic: ['집밥 레시피', '자취요리', '다이어트 레시피', '간단 요리', '도시락'], overseas: ['easy recipes', 'meal prep'] },
  { category: '다이어트·운동', domestic: ['홈트', '다이어트 식단', '필라테스', '뱃살 빼기', '러닝'], overseas: ['home workout', 'weight loss tips'] },
  { category: '패션', domestic: ['데일리룩', '코디 추천', '무신사 추천', '체형별 코디', '출근룩'], overseas: ['outfit ideas', 'fashion haul'] },
  { category: '반려동물', domestic: ['강아지 훈련', '고양이 집사', '반려견 용품', '강아지 일상', '고양이 행동'], overseas: ['dog training', 'cat tips'] },
  { category: 'AI', domestic: ['AI 활용법', '챗GPT 꿀팁', 'AI 툴 추천', '업무 자동화', 'AI 영상 만들기'], overseas: ['ai tools', 'chatgpt tips'] },
  { category: '부업', domestic: ['부업', '직장인 부업', '블로그 수익', '스마트스토어', 'N잡'], overseas: ['side hustle', 'make money online'] },
  { category: '부동산', domestic: ['부동산', '청약 꿀팁', '내집마련', '전세 계약 주의', '아파트 임장'], overseas: ['real estate tips', 'first time home buyer'] },
  { category: '재테크', domestic: ['재테크', '짠테크', '주식 초보', '적금 추천', '사회초년생 재테크'], overseas: ['personal finance', 'investing tips'] },
  { category: '여행', domestic: ['여행 꿀팁', '국내여행', '일본 여행', '해외여행 준비', '호캉스'], overseas: ['travel tips', 'travel hacks'] },
  { category: '자기계발', domestic: ['자기계발', '습관 만들기', '독서 추천', '시간관리', '동기부여'], overseas: ['self improvement', 'productivity tips'] },
  { category: '교육', domestic: ['공부법', '영어공부', '수능 공부', '자격증 공부', '초등 교육'], overseas: ['study tips', 'study with me'] },
  { category: '전문직(회사홍보)', domestic: ['직장인 꿀팁', '변호사 상식', '세무 상식', '노무 상식', '의사 상식'], overseas: ['lawyer explains', 'doctor explains'] },
  { category: '테크 가젯', domestic: ['아이폰 꿀팁', '테크 리뷰', '갤럭시 꿀팁', '맥북 꿀팁', '가성비 전자기기'], overseas: ['tech gadgets', 'iphone tips'] },
  { category: '멘탈케어', domestic: ['마음챙김', '멘탈관리', '불안 극복', '자존감', '심리 상담'], overseas: ['mental health tips', 'self care'] },
]

// Every day covers every category: one domestic and one overseas seed each,
// rotating so all seeds are searched within a few days.
export function keywordsForDay(day) {
  return SUCCESS_REEL_KEYWORDS.flatMap(({ category, domestic, overseas }) => [
    { category, keyword: domestic[day % domestic.length], region: 'domestic' },
    { category, keyword: overseas[day % overseas.length], region: 'overseas' },
  ])
}
