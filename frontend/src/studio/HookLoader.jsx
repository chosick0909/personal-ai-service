import { useEffect, useState } from 'react'

// Shared "훅ai 작업 중" panel: a gauge that follows real stages, a typed line after 10 s, a quiz later.
const LINES = [
  [10, '생각보다 오래 걸리죠? 훅ai가 지금 열심히 일하는 중이에요.'],
  [20, '따끈따끈한 결과가 구워지는 중. 기지개 한 번 켜볼까요?'],
  [60, '보통 1~2분 걸려요. 간식 챙겨 오셔도 돼요.'],
  [90, '설마… 지금 끌까 말까 고민 중이세요? 진짜요…? ㅠㅠ'],
  [120, '조금만 더요. 끝나면 바로 보여드릴게요.'],
  [180, '오래 걸리네요. 이 화면을 떠나도 계속 만들어지니 걱정 마세요.'],
]
const QUIZZES = [
  { q: '콘텐츠 수익화에서 가장 중요한 건?', options: ['광고비', '기획', '조회수'], answer: 1, right: '정답! 수익화의 핵심은 "사람 마음을 사로잡는 기획"이에요. 지금 그걸 만드는 중이고요.', wrong: '앗, 아쉬워요. 정답은 "기획". 기획 없는 광고비는 밑 빠진 독이거든요.' },
  { q: '릴스에서 시청자가 넘길지 정하는 시간은?', options: ['3초', '10초', '30초'], answer: 0, right: '정답! 그래서 첫 문장이 제일 중요해요.', wrong: '정답은 3초예요. 그래서 첫 문장을 그렇게 공들이는 거예요.' },
  { q: '썸네일 제목은 몇 글자가 좋을까요?', options: ['8~15자', '30자 이상', '길수록 좋다'], answer: 0, right: '정답! 한눈에 읽혀야 눌러요.', wrong: '정답은 8~15자. 한눈에 읽히는 게 먼저예요.' },
]

function Typed({ text }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    let i = 0
    const timer = setInterval(() => { i += 1; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(timer) }, 28)
    return () => clearInterval(timer)
  }, [text])
  return <span>{shown}<i className="st-cursor" /></span>
}

export default function HookLoader({ title = '훅ai가 만드는 중', stages = [], stageIndex = 0, startedAt, note = '이 화면을 떠나도 계속 만들어져요. 끝나면 알려드릴게요.' }) {
  const [elapsed, setElapsed] = useState(0)
  const [quiz] = useState(() => QUIZZES[Math.floor(Math.random() * QUIZZES.length)])
  const [picked, setPicked] = useState(null)
  useEffect(() => {
    const base = startedAt ? Date.parse(startedAt) : Date.now()
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - base) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const total = Math.max(1, stages.length)
  const percent = Math.min(96, Math.round(((stageIndex + Math.min(0.8, elapsed / 90)) / total) * 100))
  const line = [...LINES].reverse().find(([at]) => elapsed >= at)?.[1]
  const showQuiz = elapsed >= 35 && elapsed < 120
  return <div className="st-loader" role="status" aria-live="polite">
    <div className="st-loader-top"><span className="st-avatar">훅</span>{title}</div>
    <div className="st-gauge"><i style={{ width: `${percent}%` }} /></div>
    <div className="st-loader-stage"><span>{stages[stageIndex] || '준비 중'}</span><span>{elapsed}초</span></div>
    {line && <div className="st-loader-msg"><Typed key={line} text={line} /></div>}
    {showQuiz && <div className="st-quiz">
      <strong>기다리는 김에 퀴즈 하나! {quiz.q}</strong>
      {picked === null ? <div className="st-quiz-opts">{quiz.options.map((o, i) => <button type="button" key={o} className="st-chip" onClick={() => setPicked(i)}>{i + 1}. {o}</button>)}</div>
        : <p className="st-muted">{picked === quiz.answer ? quiz.right : quiz.wrong}</p>}
    </div>}
    <div className="st-loader-foot">{note}</div>
  </div>
}
