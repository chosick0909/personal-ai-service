import { useEffect, useState } from 'react'
import HookAvatar from './HookAvatar'
import { rotatingLine, WAIT_LINES, QUIZZES, QUIZ_AFTER } from './waitLines'

// Shared "훅ai 작업 중" panel: a gauge that follows real stages, 지영's witty waiting lines and a quiz in the middle.
function Typed({ text }) {
  const [shown, setShown] = useState('')
  useEffect(() => {
    let i = 0
    const timer = setInterval(() => { i += 1; setShown(text.slice(0, i)); if (i >= text.length) clearInterval(timer) }, 28)
    return () => clearInterval(timer)
  }, [text])
  return <span>{shown}<i className="st-cursor" /></span>
}

export default function HookLoader({ title = '훅ai가 만드는 중', stages = [], stageIndex = 0, startedAt, lines = WAIT_LINES, note = '이 화면을 떠나도 계속 만들어져요. 끝나면 알려드릴게요.' }) {
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
  const line = rotatingLine(lines, elapsed)
  const showQuiz = elapsed >= QUIZ_AFTER
  return <div className="st-loader" role="status" aria-live="polite">
    <div className="st-loader-top"><HookAvatar size={38} />{title}</div>
    <div className="st-gauge"><i style={{ width: `${percent}%` }} /></div>
    <div className="st-loader-stage"><span>{stages[stageIndex] || '준비 중'}</span><span>{elapsed}초</span></div>
    {line && <div className="st-loader-msg"><Typed key={line} text={line} /></div>}
    {showQuiz && <div className="st-quiz">
      <strong>🧩 기다리는 김에 퀴즈 하나! {quiz.q}</strong>
      {picked === null ? <div className="st-quiz-opts">{quiz.options.map((o, i) => <button type="button" key={o} className="st-chip" onClick={() => setPicked(i)}>{i + 1}. {o}</button>)}</div>
        : <p className="st-muted">{picked === quiz.answer ? quiz.right : quiz.wrong}</p>}
    </div>}
    <div className="st-loader-foot">{note}</div>
  </div>
}
