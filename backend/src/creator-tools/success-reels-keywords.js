// Search seeds for the daily success-reels collection. The collector only uses these
// to find candidate accounts; categories are always decided by the account review.
// Edit here to change what the Mac mini searches; no collector reinstall is needed.
export const SUCCESS_REEL_KEYWORDS = [
  { category: '피부', domestic: ['피부관리', '여드름 관리'], overseas: ['skincare routine'] },
  { category: '뷰티', domestic: ['메이크업 꿀팁', '다이소 뷰티템'], overseas: ['makeup tips'] },
  { category: '먹방', domestic: ['먹방', '맛집 추천'], overseas: ['food review'] },
  { category: '일상', domestic: ['일상 브이로그', '자취 일상'], overseas: ['day in my life'] },
  { category: '육아', domestic: ['육아꿀팁', '육아템'], overseas: ['parenting hacks'] },
  { category: '살림', domestic: ['살림꿀팁', '정리수납'], overseas: ['cleaning hacks'] },
  { category: '요리', domestic: ['집밥 레시피', '자취요리'], overseas: ['easy recipes'] },
  { category: '다이어트·운동', domestic: ['홈트', '다이어트 식단'], overseas: ['home workout'] },
  { category: '패션', domestic: ['데일리룩', '코디 추천'], overseas: ['outfit ideas'] },
  { category: '반려동물', domestic: ['강아지 훈련', '고양이 집사'], overseas: ['dog training'] },
  { category: 'AI', domestic: ['AI 활용법', '챗GPT 꿀팁'], overseas: ['ai tools'] },
  { category: '부업', domestic: ['부업', '직장인 부업'], overseas: ['side hustle'] },
  { category: '부동산', domestic: ['부동산', '청약 꿀팁'], overseas: ['real estate tips'] },
  { category: '재테크', domestic: ['재테크', '짠테크'], overseas: ['personal finance'] },
  { category: '여행', domestic: ['여행 꿀팁', '국내여행'], overseas: ['travel tips'] },
  { category: '자기계발', domestic: ['자기계발', '습관 만들기'], overseas: ['self improvement'] },
  { category: '교육', domestic: ['공부법', '영어공부'], overseas: ['study tips'] },
  { category: '전문직(회사홍보)', domestic: ['직장인 꿀팁', '변호사 상식'], overseas: ['lawyer explains'] },
  { category: '테크 가젯', domestic: ['아이폰 꿀팁', '테크 리뷰'], overseas: ['tech gadgets'] },
  { category: '멘탈케어', domestic: ['마음챙김', '멘탈관리'], overseas: ['mental health tips'] },
]

// Rotate through every seed so each one is searched every few days without a
// burst of searches on a single day.
export function keywordsForDay(day, perDay) {
  const all = SUCCESS_REEL_KEYWORDS.flatMap(({ category, domestic, overseas }) => [
    ...domestic.map(keyword => ({ category, keyword, region: 'domestic' })),
    ...overseas.map(keyword => ({ category, keyword, region: 'overseas' })),
  ])
  const start = (day * perDay) % all.length
  return Array.from({ length: Math.min(perDay, all.length) }, (_, i) => all[(start + i) % all.length])
}
