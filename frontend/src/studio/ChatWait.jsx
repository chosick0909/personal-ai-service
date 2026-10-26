import { useEffect, useState } from 'react'
import { rotatingLine, WAIT_LINES, QUIZZES, QUIZ_AFTER } from './waitLines'

// Under 훅ai's typing dots while it answers: the same witty lines and quiz as the big loader, sized for the chat.
export default function ChatWaitLine() {
  const [elapsed, setElapsed] = useState(0)
  const [quiz] = useState(() => QUIZZES[Math.floor(Math.random() * QUIZZES.length)])
  const [picked, setPicked] = useState(null)
  useEffect(() => { const base = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - base) / 1000)), 1000); return () => clearInterval(t) }, [])
  const line = rotatingLine(WAIT_LINES, elapsed)
  return <div className="st-chat-wait" aria-live="polite">
    {line && <p>{line}</p>}
    {elapsed >= QUIZ_AFTER && <div className="st-chat-quiz"><strong>🧩 기다리는 김에 퀴즈 하나! {quiz.q}</strong>
      {picked === null ? <div className="st-quiz-opts">{quiz.options.map((o, i) => <button type="button" key={o} className="st-chip" onClick={() => setPicked(i)}>{i + 1}. {o}</button>)}</div>
        : <p className="st-muted">{picked === quiz.answer ? quiz.right : quiz.wrong}</p>}</div>}
  </div>
}

