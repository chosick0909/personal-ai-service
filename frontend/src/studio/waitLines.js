// Waiting lines: each entry is [seconds after which it may show, text]. The shown line changes every few seconds
// (cycling through the ones already allowed), so a long wait never looks frozen.
export const LINE_EVERY = 4
export function rotatingLine(lines, elapsed, every = LINE_EVERY) {
  if (elapsed < 1) return null
  const pool = lines.filter(([at]) => elapsed >= at)
  return pool.length ? pool[Math.floor(elapsed / every) % pool.length][1] : null
}

export const WORK_LINES = [
  [1, '훅ai가 지금 열심히 일하는 중이에요.'],
  [1, '하나씩 꼼꼼히 보고 있어요.'],
  [1, '끝나면 이 화면에 바로 보여드릴게요.'],
  [20, '따끈따끈한 결과가 구워지는 중. 기지개 한 번 켜볼까요?'],
  [45, '보통 1~2분 걸려요. 간식 챙겨 오셔도 돼요.'],
  [90, '설마… 지금 끌까 말까 고민 중이세요? 진짜요…? ㅠㅠ'],
  [120, '조금만 더요. 끝나면 바로 보여드릴게요.'],
  [180, '오래 걸리네요. 이 화면을 떠나도 계속 만들어지니 걱정 마세요.'],
]
export const PLAN_LINES = [
  [1, '내 주제와 고른 레퍼런스를 함께 살펴보는 중이에요.'],
  [1, '시청자가 3초 안에 멈출 한마디를 고르는 중이에요.'],
  [1, '말하듯 자연스러운 문장으로 다듬고 있어요.'],
  [1, '적어 주신 사실만 썼는지 확인하는 중이에요.'],
  ...WORK_LINES.filter(([at]) => at > 1),
]
export const CHAT_LINES = [
  [1, '요청을 꼼꼼히 읽는 중이에요.'],
  [1, '고칠 부분만 골라 다시 쓰고 있어요.'],
  [1, '말씀하신 조건을 하나씩 맞춰 보는 중이에요.'],
  [1, '말하듯 자연스러운지 한 번 더 다듬고 있어요.'],
  [25, '대본 전체를 고칠 때는 조금 더 걸려요. 거의 다 왔어요.'],
  [60, '조금만 더요. 답이 오면 여기에 바로 보여드릴게요.'],
]
export const OPENER_LINES = [
  [1, '훅ai를 부르는 중이에요.'],
  [1, '고른 레퍼런스를 살펴보는 중이에요.'],
  [1, '이 영상이 왜 먹혔는지 짚어보는 중이에요.'],
  [1, '첫 질문을 고르는 중이에요.'],
  [25, '조금만 기다려 주세요. 곧 말을 걸게요.'],
]
export const ANALYSIS_TIPS = [
  [1, '기다리는 동안 다른 릴스도 둘러보세요. 끝나면 여기서 알려드릴게요.'],
  [1, '영상의 말과 자막을 읽는 중이에요.'],
  [1, '첫 문장·전개·촬영·캡션을 정리하는 중이에요.'],
  [60, '거의 다 됐어요. 조금만 더요.'],
  [140, '오래 걸리네요. 이 화면을 떠나도 계속 분석되고, 끝나면 알려드려요.'],
]
