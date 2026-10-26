// Waiting lines and quizzes, the ones 지영 set for 훅ai: witty lines that come in over time and a quiz in the middle.
// Each line is [seconds after which it shows, text]. They come in quickly, and once all have shown they keep cycling,
// so a long wait never looks frozen.
export const WAIT_LINES = [
  [3, '생각보다 오래 걸리죠? 훅ai가 지금 열심히 일하는 중이에요.'],
  [8, '따끈따끈한 결과가 구워지는 중. 기지개 한 번 켜볼까요?'],
  [15, '보통 1~2분 걸려요. 간식 챙겨 오셔도 돼요.'],
  [25, '설마… 지금 끌까 말까 고민 중이세요? 진짜요…? ㅠㅠ'],
  [35, '조금만 더요. 끝나면 바로 보여드릴게요.'],
  [50, '오래 걸리네요. 이 화면을 떠나도 계속 만들어지니 걱정 마세요.'],
]
// While a reel analysis runs (the toast).
export const ANALYSIS_TIPS = [
  [3, '기다리는 동안 다른 릴스도 둘러보세요. 끝나면 여기서 알려드릴게요.'],
  [12, '영상의 말과 자막을 읽는 중이에요. 조금만 더요.'],
  [25, '첫 문장·전개·촬영·캡션을 정리하는 중. 거의 다 됐어요.'],
  [45, '오래 걸리네요. 이 화면을 떠나도 계속 분석되고, 끝나면 알려드려요.'],
]
export const QUIZ_AFTER = 12
export const QUIZZES = [
  { q: '콘텐츠 수익화에서 가장 중요한 건?', options: ['광고비', '기획', '조회수'], answer: 1, right: '👏 정답! 수익화의 핵심은 "사람 마음을 사로잡는 기획"이에요. 지금 그걸 만드는 중이고요.', wrong: '앗, 아쉬워요. 정답은 "기획". 기획 없는 광고비는 밑 빠진 독이거든요.' },
  { q: '릴스에서 시청자가 넘길지 정하는 시간은?', options: ['3초', '10초', '30초'], answer: 0, right: '👏 정답! 그래서 첫 문장이 제일 중요해요.', wrong: '정답은 3초예요. 그래서 첫 문장을 그렇게 공들이는 거예요.' },
  { q: '썸네일 제목은 몇 글자가 좋을까요?', options: ['8~15자', '30자 이상', '길수록 좋다'], answer: 0, right: '👏 정답! 한눈에 읽혀야 눌러요.', wrong: '정답은 8~15자. 한눈에 읽히는 게 먼저예요.' },
]

const CYCLE_EVERY = 6
export function rotatingLine(lines, elapsed) {
  const shown = lines.filter(([at]) => elapsed >= at)
  if (!shown.length) return null
  const last = lines[lines.length - 1][0]
  // Lines arrive on their schedule; after the last one they take turns.
  return elapsed < last + CYCLE_EVERY ? shown[shown.length - 1][1] : lines[Math.floor((elapsed - last) / CYCLE_EVERY) % lines.length][1]
}
