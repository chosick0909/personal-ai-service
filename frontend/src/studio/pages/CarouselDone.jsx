import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { useStudio } from '../context'
import { CAROUSEL_STAGES, draftSheet, makeSheet } from '../api'
import { CopyButton } from './CarouselStages'
import { chosenCover, chosenBody, chosenCaption, slidesText, plain, drawable, aiSlideIds } from '../carousel/plan'
import SlidePreview from '../carousel/SlidePreview'
import { downloadSlides } from '../carousel/export'

// The parts of a carousel plan that are not a stage of their own: how a 훅ai revision is previewed, and the finished carousel.
const STAGE_NAME = Object.fromEntries(CAROUSEL_STAGES)

// A 훅ai revision is previewed against the version in use: changed parts show old → new, then 이 수정 적용.
export function CarouselProposal({ proposal, carousel, applied, onApply }) {
  const slideText = s => [plain(s?.heading), plain(s?.text)].filter(Boolean).join('\n')
  const rows = proposal.stage === 'body' ? { now: (chosenBody(carousel)?.units || []).map(u => u.text), next: proposal.units.map(u => u.text) }
    : proposal.stage === 'slides' ? { now: carousel.slides.items.filter(s => s.role === 'body').map(slideText), next: proposal.slides.map(slideText) }
      : proposal.stage === 'cover' ? { now: [[chosenCover(carousel)?.kicker, chosenCover(carousel)?.text].filter(Boolean).join(' · ')], next: [[proposal.kicker, proposal.text].filter(Boolean).join(' · ')] }
        : { now: [chosenCaption(carousel)?.text || ''], next: [proposal.text] }
  // The same number of parts: each is compared with the one in its place. A part added or taken out shifts the rest,
  // so then a part counts as unchanged when it is still there, and the ones taken out are listed after.
  const paired = rows.now.length === rows.next.length
  const gone = paired ? [] : rows.now.filter(line => !rows.next.includes(line))
  // The last slide's words change with the body and the slides, and are shown with them.
  const last = proposal.stage === 'body' ? { now: chosenBody(carousel)?.closing || '', next: proposal.closing || '' }
    : proposal.stage === 'slides' ? { now: slideText(carousel.slides.items.findLast(s => s.role === 'last')), next: slideText(proposal.last) } : null
  return <div className="st-proposal">
    <strong>{STAGE_NAME[proposal.stage]} 수정안 · {proposal.summary || '미리보기'}</strong>
    <div className="st-proposal-card st-diff">{rows.next.map((line, i) => { const before = paired ? rows.now[i] : null, changed = paired ? before !== line : !rows.now.includes(line)
      return <div key={i} className={changed ? 'is-changed' : ''} style={{ whiteSpace: 'pre-wrap' }}>{changed && before && <s>{before}</s>}<span>{line}</span></div> })}
      {gone.map((line, i) => <div key={`d${i}`} className="is-changed" style={{ whiteSpace: 'pre-wrap' }}><s>{line}</s><span className="st-muted st-small">삭제</span></div>)}
      {last?.next && <div className={last.next !== last.now ? 'is-changed' : ''} style={{ whiteSpace: 'pre-wrap' }}><span className="st-muted st-small">마지막 장</span>{last.next !== last.now && last.now && <s>{last.now}</s>}<span>{last.next}</span></div>}
      {proposal.hashtags?.length > 0 && <span className="st-muted st-small">{proposal.hashtags.map(t => `#${t}`).join(' ')}</span>}</div>
    <div className="st-row">{applied ? <span className="st-pill st-pill-green"><Check size={14} /> 적용됨</span> : <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={onApply}><Check size={16} />이 수정 적용</button>}
      <CopyButton text={[rows.next.join('\n\n'), (proposal.hashtags || []).map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n')} /></div>
  </div>
}

// 총정리 한 장: the words are confirmed first (the picture's letters cannot be corrected afterwards), then drawn.
function SheetMaker({ carousel }) {
  const { toast } = useStudio()
  const [sheet, setSheet] = useState(null)
  const [busy, setBusy] = useState('')
  const [made, setMade] = useState(null)
  const draft = async () => { setBusy('draft'); try { setSheet((await draftSheet(carousel.id)).sheet); setMade(null) } catch (e) { toast({ kind: 'failed', title: '정리할 글을 만들지 못했어요', body: e.message }) } finally { setBusy('') } }
  const make = async () => { setBusy('make'); try { const r = await makeSheet(carousel.id, sheet); setMade(r); setSheet(r.sheet) } catch (e) { toast({ kind: 'failed', title: '이미지를 만들지 못했어요', body: e.message }) } finally { setBusy('') } }
  const section = (i, patch) => setSheet(s => ({ ...s, sections: s.sections.map((x, j) => j === i ? { ...x, ...patch } : x) }))
  return <section className="st-card st-stack">
    <div className="st-card-head"><div><h3>총정리 한 장</h3><p>이 캐러셀을 저장용 요약 이미지 한 장으로 만들어요. AI가 글자까지 그리기 때문에, 넣을 글을 먼저 확인해요.</p></div>
      <button type="button" className="st-btn st-btn-soft" disabled={Boolean(busy)} onClick={draft}>{busy === 'draft' ? '글 정리하는 중…' : sheet ? '글 다시 정리하기' : '정리할 글 만들기'}</button></div>
    {sheet && <>
      <div className="st-field"><label htmlFor="cr-sheet-title">제목</label><input id="cr-sheet-title" className="st-input" value={sheet.title} maxLength={28} onChange={e => setSheet(s => ({ ...s, title: e.target.value }))} /></div>
      <div className="st-field"><label htmlFor="cr-sheet-sub">부제<small>없어도 돼요</small></label><input id="cr-sheet-sub" className="st-input" value={sheet.subtitle} maxLength={40} onChange={e => setSheet(s => ({ ...s, subtitle: e.target.value }))} /></div>
      {sheet.sections.map((sec, i) => <div className="st-cr-unit" key={i}><span className="st-cr-num">{i + 1}</span><div className="st-stack" style={{ gap: 8 }}>
        <input className="st-input" style={{ minHeight: 48, fontWeight: 800 }} value={sec.heading} maxLength={22} onChange={e => section(i, { heading: e.target.value })} aria-label={`${i + 1}번째 묶음 이름`} />
        <textarea className="st-textarea" style={{ minHeight: 84 }} value={sec.lines.join('\n')} onChange={e => section(i, { lines: e.target.value.split('\n') })} aria-label={`${i + 1}번째 묶음 내용 (한 줄에 하나, 세 줄까지)`} /></div>
        <div className="st-cr-tools"><button type="button" className="st-icon-btn" aria-label="이 묶음 지우기" disabled={sheet.sections.length <= 1} onClick={() => setSheet(s => ({ ...s, sections: s.sections.filter((_, j) => j !== i) }))}><Trash2 size={16} /></button></div></div>)}
      <div className="st-field"><label htmlFor="cr-sheet-foot">맨 아래 작은 글<small>없어도 돼요</small></label><input id="cr-sheet-foot" className="st-input" value={sheet.footer} maxLength={30} onChange={e => setSheet(s => ({ ...s, footer: e.target.value }))} /></div>
      <p className="st-note st-note-warn st-small">숫자와 사실은 지금 꼭 확인해 주세요. 이미지 안의 글자는 만든 뒤에 고칠 수 없어서, 고치려면 다시 만들어야 해요. 한 번 만들 때 이번 달 AI 이미지 5장으로 계산돼요(글자가 틀려 다시 그리면 10장).</p>
      <button type="button" className="st-btn st-btn-primary st-btn-big" style={{ justifySelf: 'start' }} disabled={Boolean(busy) || !sheet.title.trim()} onClick={make}>{busy === 'make' ? '그리는 중… 1~2분 걸려요' : made ? '이 글로 다시 만들기' : '이 글로 이미지 만들기'}</button>
    </>}
    {made && <div className="st-stack">
      {made.problems.length > 0 ? <div className="st-note st-note-warn st-small"><strong>훅ai가 이미지의 글자를 다시 읽어 봤더니 다른 곳이 있어요.</strong><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{made.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>쓰기 전에 꼭 확인하고, 틀렸으면 다시 만들어 주세요.</div>
        : <div className="st-note st-small">훅ai가 이미지의 글자를 다시 읽어 확인했어요. 넣기로 한 글과 같아요.</div>}
      <div className="st-cr-made"><img src={made.image.url} alt="총정리 한 장" style={{ width: 'min(360px,100%)' }} /><a className="st-btn st-btn-primary" href={made.image.url} download={`${carousel.title || 'carousel'}-총정리.jpg`} target="_blank" rel="noreferrer">이미지 받기</a></div>
      <p className="st-muted st-small">AI가 만든 이미지예요. 올릴 때 AI로 만들었다고 알려 주세요. 내 보관함에도 저장됐어요.</p>
    </div>}
  </section>
}

export function CarouselDone({ carousel, images }) {
  const { toast } = useStudio()
  const slides = carousel.slides.items, view = drawable(carousel.design, images), caption = chosenCaption(carousel)
  const [busy, setBusy] = useState('')
  const download = async () => { setBusy('준비 중'); try { await downloadSlides(slides, view, { name: carousel.title || 'carousel', aiSlideIds: aiSlideIds(carousel.design, images), onProgress: (done, total) => setBusy(`${done} / ${total}`) }) } catch (e) { toast({ kind: 'failed', title: '이미지를 만들지 못했어요', body: e.message }) } finally { setBusy('') } }
  return <div className="st-stack">
    <section className="st-card st-stack"><div className="st-card-head"><div><h3>완성된 캐러셀 · {slides.length}장</h3><p>번호 순서대로 인스타그램에 올리면 돼요.</p></div>
      <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={Boolean(busy)} onClick={download}>{busy ? `만드는 중 ${busy}` : `전체 받기 (${slides.length}장)`}</button></div>
      <div className="st-cr-strip">{slides.map((s, i) => <SlidePreview key={s.id} slide={s} index={i} total={slides.length} design={view} />)}</div></section>
    {caption && <section className="st-card st-stack"><div className="st-card-head"><h3>캡션</h3><CopyButton text={`${caption.text}\n\n${(caption.hashtags || []).map(t => `#${t}`).join(' ')}`} label="캡션 복사" /></div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{caption.text}</p><p className="st-muted">{(caption.hashtags || []).map(t => `#${t}`).join(' ')}</p></section>}
    <SheetMaker carousel={carousel} />
    <section className="st-card st-row" style={{ justifyContent: 'space-between' }}><div><strong>글만 받아 가기</strong><p className="st-muted st-small">디자인은 다른 도구로 하고 싶을 때 써요.</p></div><CopyButton text={slidesText(slides)} label="장별 글 복사" /></section>
  </div>
}
