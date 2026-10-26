import { useEffect, useState } from 'react'
import { PlayCircle, Lightbulb } from 'lucide-react'
import { MANUAL } from '../manualContent'

// 사용 설명서: every section is a real screenshot with numbered boxes, and numbered steps that match the boxes,
// written so a first-time (often 50+) student can follow along without help.
function Shot({ src, alt, marks }) {
  return <figure className="st-man-shot">
    <div className="st-man-frame">
      <img src={src} alt={alt} loading="lazy" />
      {marks.map(m => <div key={m.n} className="st-man-mark" style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%` }}>
        <span className={`st-man-num st-man-num-${m.at || 'tl'}`}>{m.n}</span></div>)}
    </div>
    <figcaption>{alt}</figcaption>
  </figure>
}

export default function ManualPage({ onTour }) {
  const [current, setCurrent] = useState(MANUAL[0].id)
  useEffect(() => {
    const seen = new IntersectionObserver(entries => { const top = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (top) setCurrent(top.target.id) }, { rootMargin: '-80px 0px -60% 0px' })
    MANUAL.forEach(s => { const el = document.getElementById(s.id); if (el) seen.observe(el) })
    return () => seen.disconnect()
  }, [])
  const jump = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return <div className="st-manual">
    <nav className="st-man-toc" aria-label="설명서 목차">
      <strong>목차</strong>
      {MANUAL.map((s, i) => <button type="button" key={s.id} aria-current={current === s.id ? 'true' : undefined} onClick={() => jump(s.id)}><b>{i + 1}</b>{s.title}</button>)}
    </nav>
    <div className="st-man-body">
      <section className="st-man-hero">
        <h2>훅ai 사용 설명서</h2>
        <p>화면 사진의 <b>빨간 번호</b>와 아래 <b>순서 번호</b>가 같아요. 번호 순서대로 눌러 보시면 돼요.</p>
        <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={onTour}><PlayCircle size={22} />화면 둘러보기 다시 보기</button>
      </section>
      {MANUAL.map((s, i) => <section key={s.id} id={s.id} className="st-man-section">
        <span className="st-man-chapter">{i + 1}</span>
        <h2>{s.title}</h2>
        <p className="st-man-lead">{s.lead}</p>
        {s.shots.map(shot => <div key={shot.src} className="st-man-block">
          {shot.heading && <h3>{shot.heading}</h3>}
          <Shot src={shot.src} alt={shot.alt} marks={shot.marks} />
          <ol className="st-man-steps">{shot.steps.map((step, n) => <li key={n}><span className="st-man-num">{n + 1}</span><div><strong>{step[0]}</strong>{step[1] && <p>{step[1]}</p>}</div></li>)}</ol>
        </div>)}
        {s.tips?.length > 0 && <aside className="st-man-tip"><Lightbulb size={20} /><div>{s.tips.map(t => <p key={t}>{t}</p>)}</div></aside>}
      </section>)}
    </div>
  </div>
}
