import { useMemo, useRef, useState } from 'react'
import { Minus, Move, Plus, RotateCcw } from 'lucide-react'
import SlidePreview from './SlidePreview'
import { RATIOS } from './templates'

const NAMES = { heading: '제목', text: '본문' }
const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
const SCALE_STEP = 0.1
const NUDGE = 0.005
const SLOP = 18 // canvas pixels around a block that still pick it up

// 자유 편집: the selected slide, where the student drags its title or text to another spot and makes either larger or
// smaller. The layout still decides everything else; a move is kept as a share of the slide size so it survives the
// 4:5 ↔ 3:4 switch. `onSave(move)` stores the slide's moves (null when everything is back in place).
export default function MovableSlide({ slide, index, total, design, onSave }) {
  const saved = design.slides?.[slide.id]?.move || null
  // A drag in progress (or a change not yet saved) belongs to the saved moves it started from: once the saved moves
  // change, it is dropped.
  const [pending, setPending] = useState(null)
  const draft = pending && pending.from === saved ? pending.move : null
  const setDraft = next => setPending({ from: saved, move: next })
  const [boxes, setBoxes] = useState({})
  const [picked, setPicked] = useState(null)
  const frame = useRef(null)
  const drag = useRef(null)
  const move = useMemo(() => draft || saved || {}, [draft, saved])
  const view = useMemo(() => ({ ...design, slides: { ...design.slides, [slide.id]: { ...(design.slides?.[slide.id] || {}), move } } }), [design, slide.id, move])
  const [W, H] = RATIOS[design.ratio] || RATIOS['4:5']
  const point = event => { const r = frame.current.getBoundingClientRect(); return { x: (event.clientX - r.left) / r.width * W, y: (event.clientY - r.top) / r.height * H } }
  const hit = p => Object.entries(boxes).filter(([, b]) => p.x >= b.x - SLOP && p.x <= b.x + b.w + SLOP && p.y >= b.y - SLOP && p.y <= b.y + b.h + SLOP)
    .sort((a, b) => a[1].w * a[1].h - b[1].w * b[1].h)[0]?.[0] || null
  const of = key => ({ x: 0, y: 0, scale: 1, ...(move[key] || {}) })
  const tidy = next => { const out = {}
    for (const [key, v] of Object.entries(next)) if (v && (Math.abs(v.x) > 0.0005 || Math.abs(v.y) > 0.0005 || Math.abs(v.scale - 1) > 0.001)) out[key] = { x: +v.x.toFixed(4), y: +v.y.toFixed(4), scale: +v.scale.toFixed(2) }
    return Object.keys(out).length ? out : null }
  const commit = next => { const clean = tidy(next); setDraft(clean || {}); onSave(clean) }
  const change = (key, patch) => commit({ ...move, [key]: { ...of(key), ...patch } })

  const down = event => {
    const p = point(event), key = hit(p)
    setPicked(key)
    if (!key) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { key, start: p, base: of(key), moved: false }
  }
  const over = event => {
    const d = drag.current
    if (!d) return
    const p = point(event)
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 6) return
    d.moved = true
    setDraft({ ...move, [d.key]: { ...d.base, x: clamp(d.base.x + (p.x - d.start.x) / W, -1, 1), y: clamp(d.base.y + (p.y - d.start.y) / H, -1, 1) } })
  }
  const up = () => { const d = drag.current; drag.current = null; if (d?.moved && draft) commit(draft) }
  const key = event => {
    if (!picked) return
    const step = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[event.key]
    if (!step) return
    event.preventDefault()
    const v = of(picked)
    change(picked, { x: clamp(v.x + step[0] * (event.shiftKey ? 5 : 1), -1, 1), y: clamp(v.y + step[1] * (event.shiftKey ? 5 : 1), -1, 1) })
  }
  const box = picked && boxes[picked]
  const has = Object.keys(boxes)
  return <div className="st-stack" style={{ gap: 10 }}>
    <div ref={frame} className="st-cr-movable" tabIndex={0} role="application" aria-label={`${index + 1}장 미리보기. 제목이나 본문을 끌어서 옮겨요. 고른 뒤 방향키로 조금씩 옮길 수 있어요.`}
      onPointerDown={down} onPointerMove={over} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
      <SlidePreview slide={slide} index={index} total={total} design={view} onDraw={r => setBoxes(r.boxes || {})} immediate={Boolean(draft)} />
      {has.map(k => { const b = boxes[k]; return <span key={k} className={`st-cr-box${k === picked ? ' is-picked' : ''}`}
        style={{ left: `${b.x / W * 100}%`, top: `${b.y / H * 100}%`, width: `${b.w / W * 100}%`, height: `${b.h / H * 100}%` }} /> })}
    </div>
    {has.length > 0 && <div className="st-chips" role="group" aria-label="옮길 글 고르기">{has.map(k => <button type="button" key={k} className="st-chip st-chip-soft" aria-pressed={picked === k} onClick={() => setPicked(k)}><Move size={14} />{NAMES[k]}</button>)}</div>}
    {box ? <div className="st-row" style={{ gap: 6 }}>
      <button type="button" className="st-btn st-btn-soft st-btn-sm" aria-label={`${NAMES[picked]} 글자 작게`} disabled={of(picked).scale <= 0.6} onClick={() => change(picked, { scale: clamp(of(picked).scale - SCALE_STEP, 0.6, 1.6) })}><Minus size={15} />작게</button>
      <button type="button" className="st-btn st-btn-soft st-btn-sm" aria-label={`${NAMES[picked]} 글자 크게`} disabled={of(picked).scale >= 1.6} onClick={() => change(picked, { scale: clamp(of(picked).scale + SCALE_STEP, 0.6, 1.6) })}><Plus size={15} />크게</button>
      <button type="button" className="st-btn st-btn-ghost st-btn-sm" disabled={!move[picked]} onClick={() => commit({ ...move, [picked]: null })}><RotateCcw size={15} />{NAMES[picked]} 제자리로</button>
    </div> : <p className="st-muted st-small">{has.length ? '제목이나 본문을 눌러 고른 뒤 끌어서 옮겨요.' : '이 장에는 옮길 글이 없어요.'}</p>}
    {saved && <button type="button" className="st-btn st-btn-ghost st-btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setPicked(null); commit({}) }}>이 장 처음 배치로</button>}
  </div>
}
