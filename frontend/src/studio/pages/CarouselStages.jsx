import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Merge, Plus, Scissors, Trash2, TriangleAlert } from 'lucide-react'
import { useStudio } from '../context'
import { chosenBody, chosenCaption, slidesText } from '../carousel/plan'
import SlidePreview from '../carousel/SlidePreview'
import { CAROUSEL_TEMPLATES, carouselTemplate, slideOverflows, slideLength, MAX_CAROUSEL_SLIDES, COVER_KICKER_LIMIT } from '../../../../shared/carousel-templates.mjs'

const OPTION_NAME = ['1안', '2안', '3안']
const PREVIEW_DESIGN = { template: 'dark-accent', ratio: '4:5', colors: {}, fonts: {}, slides: {} }
const move = (list, from, to) => { if (to < 0 || to >= list.length) return list; const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next }

export function CopyButton({ text, label = '복사' }) {
  const { toast } = useStudio()
  return <button type="button" className="st-btn st-btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => toast({ kind: 'ready', title: '복사했어요', body: '붙여 넣어 쓰세요.', ttl: 3000 })).catch(() => toast({ kind: 'failed', title: '복사하지 못했어요', body: '글을 직접 선택해 복사해 주세요.' }))}><Copy size={16} />{label}</button>
}

// ---------- 표지 제목 ----------
export function CoverStage({ carousel, save }) {
  const c = carousel.cover
  const [custom, setCustom] = useState(c.custom || '')
  const [kicker, setKicker] = useState(c.customKicker || '')
  const typed = () => { if (custom.trim() !== (c.custom || '') || kicker.trim() !== (c.customKicker || '')) save({ cover: { custom: custom.trim(), customKicker: kicker.trim() } }) }
  return <div className="st-stack">
    <section className="st-card st-stack">
      <div className="st-card-head"><div><h3>표지 제목 3안</h3><p>첫 장에 크게 들어가요. 피드에서 작게 보여도 읽히는 제목을 골라주세요.</p></div></div>
      {c.plan?.reader && <div className="st-note st-small"><strong>이 표지가 멈춰 세울 사람</strong> {c.plan.reader}<br /><strong>끝까지 넘기면 얻는 것</strong> {c.plan.promise}</div>}
      <div className="st-options">{c.options.map((o, i) => <button type="button" key={i} className="st-option st-cr-cover-option" aria-pressed={!c.custom && c.chosen === i} onClick={() => { setCustom(''); setKicker(''); save({ cover: { chosen: i } }) }}>
        {/* The cover as it will look, at about the size it has in a profile grid: a title must read at this size. */}
        <span className="st-cr-cover-mini" aria-hidden="true"><SlidePreview slide={{ id: `cover-${i}`, role: 'cover', heading: o.text, text: o.kicker || '' }} index={0} total={6} design={PREVIEW_DESIGN} /></span>
        <span className="st-stack" style={{ gap: 6 }}>
          <span className="st-option-top">{o.label ? <span className="st-pill">{o.label}</span> : <span className="st-pill st-pill-gray">{OPTION_NAME[i]}</span>}{o.hint && <span className="st-option-hint">{o.hint}</span>}<span className="st-option-check"><Check size={16} /></span></span>
          {o.kicker && <span className="st-muted" style={{ fontSize: 15, fontWeight: 700 }}>{o.kicker}</span>}
          <strong style={{ fontSize: 22 }}>{o.text}</strong>{o.why && <span className="st-why">{o.why}</span>}</span></button>)}</div>
      <p className="st-muted st-small">왼쪽 그림은 프로필에서 작게 보일 때의 크기예요. 틀과 색은 디자인 단계에서 정해요.</p>
    </section>
    <section className="st-card st-stack"><h3>직접 쓰기</h3>
      <div className="st-field"><label htmlFor="cr-kicker">제목 위 작은 한 줄<small>없어도 돼요</small></label><input id="cr-kicker" className="st-input" value={kicker} maxLength={COVER_KICKER_LIMIT} onChange={e => setKicker(e.target.value)} onBlur={typed} /></div>
      <div className="st-field"><label htmlFor="cr-title">표지 제목</label><input id="cr-title" className="st-input" value={custom} maxLength={60} onChange={e => setCustom(e.target.value)} onBlur={typed} placeholder="직접 쓰면 위 3안 대신 이 제목을 써요" /></div>
    </section>
  </div>
}

// ---------- 본문 기획 ----------
export function BodyStage({ carousel, save }) {
  const b = carousel.body, current = chosenBody(carousel)
  const [units, setUnits] = useState(current.units.map(u => u.text))
  const [closing, setClosing] = useState(current.closing || '')
  const [dirty, setDirty] = useState(false)
  const change = next => { setUnits(next); setDirty(true) }
  const store = () => { if (!dirty) return; setDirty(false); save({ body: { edited: { units: units.map(text => ({ text })).filter(u => u.text.trim()), closing } } }) }
  return <div className="st-stack">
    <section className="st-card st-stack">
      <div className="st-card-head"><div><h3>본문 3안</h3><p>표지 다음 장부터 마지막 장 앞까지의 내용이에요. 아직 장으로 나누기 전이라, 흐름만 보고 골라주세요.</p></div></div>
      <div className="st-options st-options-scripts">{b.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={!b.edited && b.chosen === i} onClick={() => save({ body: { chosen: i } })}>
        <div className="st-option-top"><span className="st-pill">{OPTION_NAME[i]}</span><span className="st-muted st-small">덩어리 {o.units.length}개</span><span className="st-option-check"><Check size={16} /></span></div>
        <strong>{o.label}</strong>{o.why && <span className="st-why">{o.why}</span>}
        <ol className="st-option-lines">{o.units.map((u, j) => <li key={j} style={{ whiteSpace: 'pre-wrap' }}>{u.text}</li>)}</ol></button>)}</div>
    </section>
    <section className="st-card st-stack" id="cr-body-editor">
      <div className="st-card-head"><div><h3>고른 본문 다듬기</h3><p>한 칸이 한 가지 이야기예요. 순서를 바꾸거나 고쳐 쓰세요. 훅ai에게 말로 고쳐 달라고 해도 돼요.</p></div>{b.edited && <span className="st-pill st-pill-green">직접 고친 버전</span>}</div>
      <div className="st-stack" style={{ gap: 10 }}>{units.map((text, i) => <div className="st-cr-unit" key={i}>
        <span className="st-cr-num">{i + 1}</span>
        <textarea className="st-textarea" style={{ minHeight: 84 }} value={text} onChange={e => change(units.map((u, j) => j === i ? e.target.value : u))} onBlur={store} aria-label={`${i + 1}번째 덩어리`} />
        <div className="st-cr-tools">
          <button type="button" className="st-icon-btn" aria-label="위로" disabled={i === 0} onClick={() => { const next = move(units, i, i - 1); setUnits(next); save({ body: { edited: { units: next.map(t => ({ text: t })), closing } } }) }}><ArrowUp size={16} /></button>
          <button type="button" className="st-icon-btn" aria-label="아래로" disabled={i === units.length - 1} onClick={() => { const next = move(units, i, i + 1); setUnits(next); save({ body: { edited: { units: next.map(t => ({ text: t })), closing } } }) }}><ArrowDown size={16} /></button>
          <button type="button" className="st-icon-btn" aria-label="지우기" disabled={units.length <= 2} onClick={() => { const next = units.filter((_, j) => j !== i); setUnits(next); save({ body: { edited: { units: next.map(t => ({ text: t })), closing } } }) }}><Trash2 size={16} /></button>
        </div></div>)}</div>
      <button type="button" className="st-btn st-btn-soft" style={{ justifySelf: 'start' }} onClick={() => change([...units, ''])}><Plus size={18} />덩어리 추가</button>
      <div className="st-field"><label htmlFor="cr-closing">마지막 장 문구<small>저장·공유·댓글을 부르는 한두 줄</small></label><textarea id="cr-closing" className="st-textarea" style={{ minHeight: 72 }} value={closing} onChange={e => { setClosing(e.target.value); setDirty(true) }} onBlur={store} /></div>
    </section>
  </div>
}

// ---------- 슬라이드 나누기 ----------
const ROLE_NAME = { cover: '표지', body: '본문', last: '마지막 장' }
// A slide over its template's limit is cut where the reader would pause: at the line break nearest the middle.
function halves(slide) {
  const lines = String(slide.text || '').split('\n').filter(l => l.trim())
  if (lines.length < 2) { const words = String(slide.text || '').split(' '); const mid = Math.ceil(words.length / 2); return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')] }
  const mid = Math.ceil(lines.length / 2)
  return [lines.slice(0, mid).join('\n'), lines.slice(mid).join('\n')]
}
export function SlidesStage({ carousel, save, onRedo }) {
  const s = carousel.slides, template = carouselTemplate(s.template), limit = template.limits.body
  const [items, setItems] = useState(s.items)
  const [dirty, setDirty] = useState(false)
  const edit = (id, patch) => { setItems(list => list.map(x => x.id === id ? { ...x, ...patch } : x)); setDirty(true) }
  const store = (next = items) => { setDirty(false); setItems(next); save({ slides: { items: next } }) }
  const blur = () => { if (dirty) store() }
  const weak = Object.fromEntries((s.weak || []).map(w => [w.id, w.why]))
  const full = items.length >= MAX_CAROUSEL_SLIDES
  return <div className="st-stack">
    {s.stale && <div className="st-note st-note-warn st-row" style={{ justifyContent: 'space-between' }}><span>본문을 고친 뒤 아직 다시 나누지 않았어요. 아래는 고치기 전 본문으로 나눈 장이에요.</span><button type="button" className="st-btn st-btn-sm" onClick={onRedo}>고친 본문으로 다시 나누기</button></div>}
    <section className="st-card st-stack">
      <div className="st-card-head"><div><h3>어떤 틀로 만들까요?</h3><p>틀에 따라 한 장에 들어가는 글의 양이 달라요. 디자인 단계에서 다시 바꿀 수 있어요.</p></div></div>
      <div className="st-cr-templates">{CAROUSEL_TEMPLATES.map(t => <button type="button" key={t.id} className="st-option" aria-pressed={t.id === s.template} onClick={() => save({ slides: { items, template: t.id } })}>
        <div className="st-option-top"><strong style={{ fontSize: 16, marginRight: 'auto' }}>{t.name}</strong><span className="st-option-check"><Check size={16} /></span></div><span className="st-why">{t.description}</span>
        <span className="st-muted st-small">한 장에 {t.limits.body.lines}줄 · {t.limits.body.text}자까지{t.imageRequired ? ' · 사진 필요' : ''}</span></button>)}</div>
      {s.templateWhy && !s.templateChosen && <p className="st-muted st-small">훅ai가 고른 이유: {s.templateWhy}</p>}
    </section>
    <section className="st-card st-stack">
      <div className="st-card-head"><div><h3>장별 글 · 모두 {items.length}장</h3><p>나누는 곳과 순서를 바꿀 수 있어요. 강조할 말은 <code>**이렇게**</code> 별표 두 개로 감싸요.</p></div><CopyButton text={slidesText(items)} label="장별 글 복사" /></div>
      <ol className="st-cr-slides">{items.map((slide, i) => { const over = slideOverflows(s.template, slide), body = slide.role === 'body', bodies = items.filter(x => x.role === 'body').length
        return <li key={slide.id} className={over ? 'is-over' : ''}>
          <div className="st-cr-slide-head"><span className="st-cr-num">{i + 1}</span><span className={`st-pill ${body ? 'st-pill-gray' : ''}`}>{ROLE_NAME[slide.role]}</span>
            {body && <span className={`st-small ${over ? 'st-cr-over' : 'st-muted'}`}>{slideLength(slide.text)} / {limit.text}자</span>}
            {body && <div className="st-cr-tools" style={{ marginLeft: 'auto' }}>
              <button type="button" className="st-icon-btn" aria-label="위로" title="위로" disabled={items[i - 1]?.role !== 'body'} onClick={() => store(move(items, i, i - 1))}><ArrowUp size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label="아래로" title="아래로" disabled={items[i + 1]?.role !== 'body'} onClick={() => store(move(items, i, i + 1))}><ArrowDown size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label="앞 장과 합치기" title="앞 장과 합치기" disabled={items[i - 1]?.role !== 'body'} onClick={() => store(items.flatMap((x, j) => j === i - 1 ? [{ ...x, text: [x.text, slide.text].filter(Boolean).join('\n') }] : j === i ? [] : [x]))}><Merge size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label="두 장으로 나누기" title="두 장으로 나누기" disabled={full || slideLength(slide.text) < 8} onClick={() => { const [a, b] = halves(slide); store(items.flatMap(x => x.id === slide.id ? [{ ...x, text: a }, { role: 'body', heading: '', text: b }] : [x])) }}><Scissors size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label="이 장 지우기" title="이 장 지우기" disabled={bodies <= 1} onClick={() => store(items.filter(x => x.id !== slide.id))}><Trash2 size={16} /></button>
            </div>}</div>
          {(slide.role !== 'body' || limit.heading > 0) && <input className="st-input" style={{ minHeight: 48, fontWeight: 800 }} value={slide.heading} placeholder={slide.role === 'cover' ? '표지 제목' : slide.role === 'last' ? '마지막 장 제목 (없어도 돼요)' : '소제목 (없어도 돼요)'} onChange={e => edit(slide.id, { heading: e.target.value })} onBlur={blur} aria-label={`${i + 1}장 제목`} />}
          <textarea className="st-textarea" style={{ minHeight: slide.role === 'body' ? 96 : 60 }} value={slide.text} placeholder={slide.role === 'cover' ? '제목 위 작은 한 줄 (없어도 돼요)' : slide.role === 'last' ? '마지막 장 문구' : '이 장의 글'} onChange={e => edit(slide.id, { text: e.target.value })} onBlur={blur} aria-label={`${i + 1}장 글`} />
          {over && <p className="st-cr-over st-small"><TriangleAlert size={15} /> 이 틀에 넣기엔 글이 많아요. 줄이거나 가위 버튼으로 두 장으로 나눠 주세요.</p>}
          {weak[slide.id] && <p className="st-note st-note-warn st-small">넘김 점검: {weak[slide.id]}</p>}
        </li> })}</ol>
      <button type="button" className="st-btn st-btn-soft" style={{ justifySelf: 'start' }} disabled={full} onClick={() => { const at = items.findIndex(x => x.role === 'last'); store([...items.slice(0, at), { role: 'body', heading: '', text: '새 장' }, ...items.slice(at)]) }}><Plus size={18} />장 추가</button>
    </section>
  </div>
}

// ---------- 캡션 ----------
export function CaptionStage({ carousel, save }) {
  const c = carousel.caption, current = chosenCaption(carousel)
  const [text, setText] = useState(current.text)
  const [tags, setTags] = useState((current.hashtags || []).join(' '))
  const store = () => { const hashtags = tags.split(/[\s,#]+/).filter(Boolean); if (text !== current.text || hashtags.join(' ') !== (current.hashtags || []).join(' ')) save({ caption: { edited: { text, hashtags } } }) }
  return <div className="st-stack">
    <section className="st-card st-stack"><div className="st-card-head"><div><h3>캡션 3안</h3><p>첫 줄은 '더 보기' 앞에 보이는 유일한 줄이에요.</p></div></div>
      <div className="st-options">{c.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={!c.edited && c.chosen === i} onClick={() => save({ caption: { chosen: i } })}>
        <div className="st-option-top"><span className="st-pill">{OPTION_NAME[i]}</span><span className="st-option-check"><Check size={16} /></span></div>
        <span style={{ whiteSpace: 'pre-wrap', fontSize: 16, lineHeight: 1.6 }}>{o.text}</span><span className="st-muted st-small">{(o.hashtags || []).map(t => `#${t}`).join(' ')}</span>{o.why && <span className="st-why">{o.why}</span>}</button>)}</div>
    </section>
    <section className="st-card st-stack"><div className="st-card-head"><h3>고른 캡션 다듬기</h3><CopyButton text={`${text}\n\n${tags.split(/[\s,#]+/).filter(Boolean).map(t => `#${t}`).join(' ')}`} label="캡션 복사" /></div>
      <textarea className="st-textarea" style={{ minHeight: 200 }} value={text} onChange={e => setText(e.target.value)} onBlur={store} aria-label="캡션" />
      <div className="st-field"><label htmlFor="cr-tags">해시태그<small>띄어쓰기로 구분해요</small></label><input id="cr-tags" className="st-input" value={tags} onChange={e => setTags(e.target.value)} onBlur={store} /></div>
    </section>
  </div>
}
