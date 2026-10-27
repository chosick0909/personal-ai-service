import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { WHATS_NEW, TOUR_STEPS, hidePopupForADay, markTourDone } from './guideData'
import avatar from './assets/hookai-avatar.webp'

const SLIDE_SECONDS = 10

export function UpdatePopup({ onClose, onTour }) {
  const [i, setI] = useState(0)
  const slide = WHATS_NEW[i]
  const close = useCallback((forADay = false) => { if (forADay) hidePopupForADay(); onClose() }, [onClose])
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') setI(n => Math.min(WHATS_NEW.length - 1, n + 1)); if (e.key === 'ArrowLeft') setI(n => Math.max(0, n - 1)) }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [close])
  const last = i === WHATS_NEW.length - 1
  // Pages turn by themselves (paused while the pointer rests on the popup), and after the last one the tour starts.
  const advance = () => { if (last) { close(); onTour() } else setI(i + 1) }
  return <div className="st-modal st-whatsnew-wrap" role="dialog" aria-modal="true" aria-label="훅ai 업그레이드 안내">
    <div className="st-whatsnew">
      <div className="st-whatsnew-timer" aria-hidden="true"><span key={i} style={{ animationDuration: `${slide.seconds || SLIDE_SECONDS}s` }} onAnimationEnd={advance} /></div>
      <div className="st-whatsnew-media">
        {slide.welcome ? <div className="st-whatsnew-hello"><img src={avatar} alt="" /><strong>훅ai가 새 옷을 입었어요</strong><span>반가워요, 다시 만나서!</span></div>
          : <video key={slide.media} src={slide.media} autoPlay muted loop playsInline aria-hidden="true" />}
        <div className="st-whatsnew-nav">
          <button type="button" aria-label="이전" disabled={i === 0} onClick={() => setI(i - 1)}><ChevronLeft size={22} /></button>
          <div className="st-whatsnew-dots">{WHATS_NEW.map((s, n) => <button type="button" key={s.badge} aria-label={`${n + 1}번째 안내`} aria-current={n === i ? 'true' : undefined} onClick={() => setI(n)} />)}</div>
          <button type="button" aria-label="다음" disabled={last} onClick={() => setI(i + 1)}><ChevronRight size={22} /></button>
        </div>
      </div>
      <div className={`st-whatsnew-copy${slide.welcome ? ' is-welcome' : ''}`}>
        <button type="button" className="st-whatsnew-close" aria-label="닫기" onClick={() => close()}><X size={22} /></button>
        <span className="st-whatsnew-badge">NEW · 훅ai가 새롭게 업그레이드되었어요</span>
        <span className="st-whatsnew-step">{i + 1} / {WHATS_NEW.length} · {slide.badge}</span>
        <h2>{slide.title}</h2>
        <p>{slide.body}</p>
        {slide.moves && <ul className="st-whatsnew-moves" aria-label="예전 기능이 옮겨간 곳">{slide.moves.map(([from, to]) => <li key={from}><span>{from}</span><ChevronRight size={16} aria-hidden="true" /><b>{to}</b></li>)}</ul>}
        {slide.after && <p className="st-whatsnew-after">{slide.after}</p>}
        <div className="st-whatsnew-actions">
          {last ? <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={() => { close(); onTour() }}>어디에 뭐가 있는지 둘러보기</button>
            : <button type="button" className="st-btn st-btn-primary st-btn-lg" onClick={() => setI(i + 1)}>{slide.welcome ? '무엇이 좋아졌는지 보기' : '다음 기능 보기'}<ChevronRight size={20} /></button>}
        </div>
        <div className="st-whatsnew-foot"><button type="button" onClick={() => close(true)}>24시간 동안 보지 않기</button></div>
      </div>
    </div>
  </div>
}

const visibleRect = el => { const r = el?.getBoundingClientRect(); return r && r.width > 0 && r.height > 0 ? r : null }
const findTarget = target => [...document.querySelectorAll(`[data-tour="${target}"]`)].find(el => visibleRect(el)) || null

export function Tour({ onClose }) {
  const steps = TOUR_STEPS.filter(s => findTarget(s.target))
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = steps[i]
  const finish = useCallback(() => { markTourDone(); onClose() }, [onClose])
  useLayoutEffect(() => {
    if (!step) return undefined
    const el = findTarget(step.target)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const place = () => setRect(visibleRect(findTarget(step.target)))
    const timer = setTimeout(place, 350); place()
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { clearTimeout(timer); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [step])
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') finish() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [finish])
  if (!step) return null
  const pad = 8
  const box = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null
  // The card sits beside the spotlight on the side with more room, and never leaves the screen.
  const vw = window.innerWidth, vh = window.innerHeight, cardW = Math.min(360, vw - 32)
  let card = { left: 16, top: 16 }
  if (box) {
    const right = box.left + box.width + 16
    if (right + cardW < vw) card = { left: right, top: Math.min(Math.max(16, box.top), vh - 260) }
    else if (box.top > 280) card = { left: Math.min(Math.max(16, box.left + box.width - cardW), vw - cardW - 16), top: box.top - 16 - 230 }
    else card = { left: Math.min(Math.max(16, box.left), vw - cardW - 16), top: Math.min(box.top + box.height + 16, vh - 260) }
  }
  const last = i === steps.length - 1
  return <div className="st-tour" role="dialog" aria-modal="true" aria-label="화면 둘러보기">
    {box && <div className="st-tour-spot" style={box} />}
    <div className="st-tour-card" style={{ ...card, width: cardW, visibility: box ? 'visible' : 'hidden' }}>
      <span className="st-tour-count">{i + 1} / {steps.length}</span>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <div className="st-tour-actions">
        <button type="button" className="st-tour-skip" onClick={finish}>건너뛰기</button>
        <div className="st-row" style={{ gap: 8 }}>
          {i > 0 && <button type="button" className="st-btn st-btn-sm" onClick={() => setI(i - 1)}>이전</button>}
          <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => last ? finish() : setI(i + 1)}>{last ? '안내 끝내기' : '다음'}</button>
        </div>
      </div>
    </div>
  </div>
}
