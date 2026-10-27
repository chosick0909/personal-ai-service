// Waiting lines and quizzes, the ones 지영 set for 훅ai: witty lines that come in over time and a quiz in the middle,
// dressed with emoji (her wording unchanged) so the wait is fun to look at.
// Each line is [seconds after which it shows, text]. They come in quickly, and once all have shown they keep cycling,
// so a long wait never looks frozen.
export const WAIT_LINES = [
  [3, '⏳ 생각보다 오래 걸리죠? 훅ai가 지금 열심히 일하는 중이에요. 💪'],
  [8, '🍞 따끈따끈한 결과가 구워지는 중. 기지개 한 번 켜볼까요? 🙆'],
  [15, '⏱️ 보통 1~2분 걸려요. 간식 챙겨 오셔도 돼요. 🍫🍬🍪'],
  [25, '👀 설마… 지금 끌까 말까 고민 중이세요? 진짜요…? ㅠㅠ 🥺'],
  [35, '🏃 조금만 더요. 끝나면 바로 보여드릴게요. ✨'],
  [50, '🐢 오래 걸리네요. 이 화면을 떠나도 계속 만들어지니 걱정 마세요. 🙌'],
]
// While a reel analysis runs (the toast).
export const ANALYSIS_TIPS = [
  [3, '👀 기다리는 동안 다른 릴스도 둘러보세요. 끝나면 여기서 알려드릴게요. 🔔'],
  [12, '🎧 영상의 말과 자막을 읽는 중이에요. 조금만 더요. ✍️'],
  [25, '🧩 첫 문장·전개·촬영·캡션을 정리하는 중. 거의 다 됐어요. 🏁'],
  [45, '🐢 오래 걸리네요. 이 화면을 떠나도 계속 분석되고, 끝나면 알려드려요. 🔔'],
]
export const QUIZ_AFTER = 12
export const QUIZZES = [
  { q: '콘텐츠 수익화에서 가장 중요한 건?', options: ['광고비', '기획', '조회수'], answer: 1, right: '👏 정답! 수익화의 핵심은 "사람 마음을 사로잡는 기획"이에요. 지금 그걸 만드는 중이고요.', wrong: '😅 앗, 아쉬워요. 정답은 "기획". 기획 없는 광고비는 밑 빠진 독이거든요.' },
  { q: '릴스에서 시청자가 넘길지 정하는 시간은?', options: ['3초', '10초', '30초'], answer: 0, right: '👏 정답! 그래서 첫 문장이 제일 중요해요.', wrong: '🙈 정답은 3초예요. 그래서 첫 문장을 그렇게 공들이는 거예요.' },
  { q: '썸네일 제목은 몇 글자가 좋을까요?', options: ['8~15자', '30자 이상', '길수록 좋다'], answer: 0, right: '👏 정답! 한눈에 읽혀야 눌러요.', wrong: '🙈 정답은 8~15자. 한눈에 읽히는 게 먼저예요.' },
  { q: '휴대폰으로 찍을 때 제일 먼저 챙길 것은?', options: ['비싼 카메라', '밝은 빛', '화려한 배경'], answer: 1, right: '👏 정답! 창가 자연광 하나면 휴대폰으로도 충분히 예뻐요. ☀️', wrong: '😅 정답은 밝은 빛! 장비보다 빛이 먼저예요. ☀️' },
  { q: '말할 때 눈은 어디를 보면 좋을까요?', options: ['화면 속 내 얼굴', '카메라 렌즈', '대본 종이'], answer: 1, right: '👏 정답! 렌즈를 봐야 시청자와 눈이 마주쳐요. 👀', wrong: '🙈 정답은 카메라 렌즈! 그래야 나를 보며 말하는 것처럼 느껴져요.' },
  { q: '세로 영상의 화면 비율은?', options: ['9:16', '16:9', '1:1'], answer: 0, right: '👏 정답! 휴대폰을 세워서 찍는 9:16이에요. 📱', wrong: '😅 정답은 9:16! 휴대폰을 세워서 찍으면 돼요. 📱' },
  { q: '자막은 화면 어디쯤 두면 좋을까요?', options: ['맨 아래 끝', '가운데보다 조금 아래', '맨 위 끝'], answer: 1, right: '👏 정답! 맨 위·아래는 앱 버튼과 글씨에 가려지기 쉬워요.', wrong: '🙈 정답은 가운데보다 조금 아래! 맨 위·아래는 버튼에 가려지기 쉬워요.' },
  { q: '캡션 첫 줄이 하는 일은?', options: ['해시태그 모아두기', '"더 보기"를 누르게 만들기', '인사하기'], answer: 1, right: '👏 정답! 첫 줄만 보이니까, 다음 줄이 궁금하게 써야 해요. ✍️', wrong: '😅 정답은 "더 보기"를 누르게 만들기! 첫 줄만 먼저 보이거든요.' },
  { q: '영상 마지막에 넣으면 좋은 것은?', options: ['부탁 딱 한 가지', '긴 인사', '아무것도 안 넣기'], answer: 0, right: '👏 정답! "저장해 두세요"처럼 한 가지만 부탁하면 더 잘 따라와요. 🙏', wrong: '🙈 정답은 부탁 딱 한 가지! 여러 개를 말하면 아무것도 안 하게 돼요.' },
  { q: '공감 가는 영상의 비결은?', options: ['어려운 전문 용어', '내가 겪은 한 장면', '긴 설명'], answer: 1, right: '👏 정답! "어, 이거 내 얘기다" 싶을 때 끝까지 봐요. 💛', wrong: '😅 정답은 내가 겪은 한 장면! 내 이야기가 제일 힘이 세요. 💛' },
  { q: '첫 영상 반응이 별로였다면?', options: ['바로 그만둔다', '고쳐서 또 올린다', '몰래 지운다'], answer: 1, right: '👏 정답! 가장 좋은 영상은 오늘 올린 영상이에요. 💪', wrong: '🥺 에이, 아니에요! 정답은 고쳐서 또 올리기. 다들 처음엔 그랬어요. 💪' },
  { q: '훅ai의 "훅"은 무슨 뜻일까요?', options: ['마음을 탁 걸어 당기는 낚싯바늘', '권투의 훅 펀치', '후크 선장'], answer: 0, right: '👏 정답! 첫 문장으로 시청자 마음을 탁 걸어 당기는 것, 그게 훅이에요. 🎣', wrong: '😂 후크 선장도 멋지지만… 정답은 마음을 걸어 당기는 낚싯바늘이에요! 🎣' },
  { q: '시청자가 끝까지 보게 하는 방법은?', options: ['처음에 얻을 것을 약속하기', '영상을 길게 만들기', '배경음악 크게 틀기'], answer: 0, right: '👏 정답! "끝까지 보면 이걸 알게 돼요"라는 약속이 있으면 기다려요. 🎁', wrong: '🙈 정답은 처음에 얻을 것을 약속하기! 그래야 끝까지 궁금해해요. 🎁' },
]

const CYCLE_EVERY = 6
export function rotatingLine(lines, elapsed) {
  const shown = lines.filter(([at]) => elapsed >= at)
  if (!shown.length) return null
  const last = lines[lines.length - 1][0]
  // Lines arrive on their schedule; after the last one they take turns.
  return elapsed < last + CYCLE_EVERY ? shown[shown.length - 1][1] : lines[Math.floor((elapsed - last) / CYCLE_EVERY) % lines.length][1]
}
