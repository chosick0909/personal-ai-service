import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronUp, MessageSquareText, PanelRightClose, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useStudio } from '../context'
import { studio, CAROUSEL_STAGES, draftSheet, makeSheet } from '../api'
import HookAvatar from '../HookAvatar'
import HookLoader from '../HookLoader'
import ChatWaitLine from '../ChatWait'
import { CoverStage, BodyStage, SlidesStage, CaptionStage, CopyButton } from './CarouselStages'
import { DesignStage } from './CarouselDesign'
import { chosenCover, chosenBody, chosenCaption, slidesText, plain, drawable, aiSlideIds } from '../carousel/plan'
import SlidePreview from '../carousel/SlidePreview'
import { downloadSlides } from '../carousel/export'

const ORDER = CAROUSEL_STAGES.map(([id]) => id)
const wide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1101px)').matches
const GEN_STAGES = ['재료 모으는 중', '훅ai가 쓰는 중', '정리하는 중']
const STAGE_NAME = Object.fromEntries(CAROUSEL_STAGES)
const NEXT_LABEL = { cover: '본문 기획하기', body: '슬라이드로 나누기', slides: '디자인하기', design: '캡션 만들기', caption: '완성하기' }

// A 훅ai revision is previewed against the version in use: changed parts show old → new, then 이 수정 적용.
function ProposalPreview({ proposal, carousel, applied, onApply }) {
  const rows = proposal.stage === 'body' ? { now: (chosenBody(carousel)?.units || []).map(u => u.text), next: proposal.units.map(u => u.text) }
    : proposal.stage === 'slides' ? { now: carousel.slides.items.filter(s => s.role === 'body').map(s => [plain(s.heading), plain(s.text)].filter(Boolean).join('\n')), next: proposal.slides.map(s => [plain(s.heading), plain(s.text)].filter(Boolean).join('\n')) }
      : proposal.stage === 'cover' ? { now: [[chosenCover(carousel)?.kicker, chosenCover(carousel)?.text].filter(Boolean).join(' · ')], next: [[proposal.kicker, proposal.text].filter(Boolean).join(' · ')] }
        : { now: [chosenCaption(carousel)?.text || ''], next: [proposal.text] }
  return <div className="st-proposal">
    <strong>{STAGE_NAME[proposal.stage]} 수정안 · {proposal.summary || '미리보기'}</strong>
    <div className="st-proposal-card st-diff">{rows.next.map((line, i) => { const before = rows.now[i], changed = before !== line
      return <div key={i} className={changed ? 'is-changed' : ''} style={{ whiteSpace: 'pre-wrap' }}>{changed && before && <s>{before}</s>}<span>{line}</span></div> })}
      {rows.now.length > rows.next.length && rows.now.slice(rows.next.length).map((line, i) => <div key={`d${i}`} className="is-changed"><s>{line}</s><span className="st-muted st-small">삭제</span></div>)}
      {proposal.hashtags?.length > 0 && <span className="st-muted st-small">{proposal.hashtags.map(t => `#${t}`).join(' ')}</span>}</div>
    <div className="st-row">{applied ? <span className="st-pill st-pill-green"><Check size={14} /> 적용됨</span> : <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={onApply}><Check size={16} />이 수정 적용</button>}
      <CopyButton text={[rows.next.join('\n\n'), (proposal.hashtags || []).map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n')} /></div>
  </div>
}

function ChatPanel({ carousel, messages, pending, busy, onSend, onApply, appliedId, open, setOpen }) {
  const log = useRef(null)
  const [text, setText] = useState('')
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [messages, pending, busy])
  // A message that failed to send goes back into the box, so nothing typed is lost.
  const send = async value => { const t = (value ?? text).trim(); if (!t || busy) return; setText(''); if (!(await onSend(t))) setText(prev => prev || t) }
  const last = messages.at(-1)
  const usable = p => p && carousel[p.stage] && (p.stage === carousel.stage || carousel.stage === 'done')
  return <>
    <aside className={`st-chat${open ? ' is-open' : ''}`} aria-label="훅ai에게 말하기">
      <div className="st-chat-head" onClick={() => { if (!wide()) setOpen(o => !o) }}><HookAvatar size={40} />훅ai에게 말하기<button type="button" className="st-icon-btn st-chat-toggle" aria-label="채팅 열기/닫기" style={{ width: 36, height: 36, border: 0 }}><ChevronUp size={18} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></button>
        <button type="button" className="st-icon-btn st-chat-fold" aria-label="채팅 접기" title="채팅 접기" onClick={() => setOpen(false)}><PanelRightClose size={20} /></button></div>
      <div className="st-chat-log" ref={log}>
        {messages.map(m => <div key={m.id} style={{ display: 'contents' }}>
          <div className={`st-msg st-msg-${m.role}`}>{m.content}</div>
          {m.role === 'hookai' && usable(m.meta?.proposal) && <ProposalPreview proposal={m.meta.proposal} carousel={carousel} applied={m.id === appliedId} onApply={() => onApply(m.id)} />}
          {m.role === 'hookai' && m === last && m.meta?.chips?.length > 0 && !busy && <div className="st-msg-chips">{m.meta.chips.map(c => <button type="button" key={c} className="st-chip" onClick={() => send(c)}>{c}</button>)}</div>}
        </div>)}
        {pending && <div className="st-msg st-msg-user">{pending}</div>}
        {busy && <><div className="st-chat-typing"><i /><i /><i /></div><ChatWaitLine /></>}
      </div>
      <form className="st-chat-input" onSubmit={e => { e.preventDefault(); send() }}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="고치고 싶은 점을 말해주세요" rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} aria-label="훅ai에게 보낼 메시지" />
        <button type="submit" className="st-btn st-btn-primary" disabled={busy || !text.trim()} aria-label="보내기"><Send size={18} /></button>
      </form>
    </aside>
    {!open && <button type="button" className="st-chat-launcher" aria-label="훅ai 채팅 펼치기" title="훅ai 채팅 펼치기" onClick={() => setOpen(true)}><HookAvatar size={48} />{busy && <i className="st-chat-launcher-dot" />}</button>}
  </>
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

function DoneStage({ carousel, images }) {
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

export default function CarouselWizard({ id }) {
  const { go, toast } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [chatOpen, setChatOpen] = useState(wide)
  const [chatBusy, setChatBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const [appliedId, setAppliedId] = useState(null)
  // Stage views keep what is being typed; a new version from 훅ai (or an applied revision) redraws them.
  const [version, setVersion] = useState(0)
  const load = useCallback(() => studio.carousel(id).then(d => { setData(d); return d }).catch(e => { setError(e.message); return null }), [id])
  useEffect(() => { load() }, [load])
  const carousel = data?.carousel
  const running = carousel?.job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(async () => { const d = await load(); if (d && d.carousel.job.status !== 'running') setVersion(v => v + 1) }, 2500)
    return () => clearInterval(timer)
  }, [running, load])
  const save = async patch => { try { const r = await studio.patchCarousel(id, patch); setData(d => ({ ...d, carousel: r.carousel, images: r.images })); return true } catch (e) { toast({ kind: 'failed', title: '저장하지 못했어요', body: e.message }); return false } }
  const toStage = async (stage, regenerate = false) => { if (!wide()) setChatOpen(false); try { const r = await studio.carouselStage(id, stage, regenerate); setData(r); setVersion(v => v + 1); window.scrollTo(0, 0) } catch (e) { toast({ kind: 'failed', title: '이동하지 못했어요', body: e.message }) } }
  const cancel = async () => { try { setData(await studio.cancelCarouselStage(id)); setVersion(v => v + 1) } catch (e) { toast({ kind: 'failed', title: '취소하지 못했어요', body: e.message }) } }
  const apply = async messageId => { try { const r = await studio.applyCarousel(id, messageId); setData(r); setVersion(v => v + 1); setAppliedId(messageId); toast({ kind: 'ready', title: '적용했어요', body: '화면에 반영됐어요.', ttl: 4000 }) } catch (e) { toast({ kind: 'failed', title: '적용 실패', body: e.message }) } }
  // 훅ai answers in the background; the plan is read again until its reply to this message shows up.
  const send = async text => {
    setChatBusy(true); setPending(text); setChatOpen(true)
    try {
      const r = await studio.carouselChat(id, text)
      const mine = r.messages[0].id
      setData(d => ({ ...d, messages: [...d.messages, ...r.messages] })); setPending(null)
      const until = Date.now() + 8 * 60000
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const d = await studio.carousel(id).catch(() => null)
        const reply = d?.messages.slice(d.messages.findIndex(m => m.id === mine) + 1).find(m => m.role === 'hookai')
        if (d) setData(d)
        if (reply) { if (reply.meta?.failed) toast({ kind: 'failed', title: '훅ai가 답하지 못했어요', body: '같은 말을 한 번만 다시 보내주세요.' }); return true }
        if (Date.now() > until) { toast({ kind: 'failed', title: '답이 늦어지고 있어요', body: '잠시 뒤 화면을 새로 고치면 답이 보일 거예요.' }); return true }
      }
    } catch (e) { toast({ kind: 'failed', title: '훅ai가 답하지 못했어요', body: e.message }); return false } finally { setChatBusy(false); setPending(null) }
  }
  if (error) return <div className="st-error">{error}</div>
  if (!carousel) return <p className="st-muted">불러오는 중…</p>
  const idx = ORDER.indexOf(carousel.stage)
  const generating = running
  const failed = carousel.job?.status === 'failed'
  const ready = carousel.stage === 'done' || Boolean(carousel[carousel.stage])
  const elapsed = carousel.job?.startedAt ? (Date.now() - Date.parse(carousel.job.startedAt)) / 1000 : 0
  const key = `${version}-${carousel.stage}`
  return <div className="st-wizard">
    <div className="st-wizard-main">
      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="st-btn st-btn-ghost" onClick={() => go('carousels')}><ArrowLeft size={20} />캐러셀 만들기</button>
        {carousel.title && <strong className="st-muted st-wizard-title" style={{ fontSize: 15 }}>{carousel.title}</strong>}
        <button type="button" className="st-btn st-btn-ghost st-chat-toggle" onClick={() => setChatOpen(o => !o)}><MessageSquareText size={18} />훅ai</button>
      </div>
      <nav className="st-stepper" aria-label="캐러셀 단계">{CAROUSEL_STAGES.map(([stage, label], i) => <span key={stage} style={{ display: 'contents' }}>{i > 0 && <span className="st-step-gap" />}
        <button type="button" className={`st-step${i < idx ? ' is-done' : ''}`} aria-current={stage === carousel.stage ? 'step' : undefined} disabled={i > idx || generating} onClick={() => i < idx && toStage(stage)}><i>{i < idx ? <Check size={15} /> : i + 1}</i>{label}</button></span>)}</nav>
      {((data.sources && Object.keys(data.sources).length > 0) || data.plan) && <div className="st-chips">{data.plan && <a className="st-pill st-pill-link" style={{ fontSize: 14 }} href={`/studio?p=plan&session=${data.plan.id}`} target="_blank" rel="noreferrer" title="이 릴스 기획안과 같은 이야기로 만들어요. 기획안을 고치면 다음 단계부터 반영돼요.">릴스 기획안 · {data.plan.title || '제목 없음'}</a>}{Object.entries(data.sources || {}).map(([slot, s]) => <a key={slot} className="st-pill st-pill-gray st-pill-link" style={{ fontSize: 14 }} href={s.permalink || `/studio?p=reference&ref=${encodeURIComponent(s.id)}`} target="_blank" rel="noreferrer">{{ structure: '구성', design: '디자인', caption: '캡션' }[slot]} · {s.label}</a>)}</div>}
      {generating ? <div className="st-stack"><HookLoader title={`훅ai가 ${STAGE_NAME[carousel.job.stage] || ''} 만드는 중`} stages={GEN_STAGES} stageIndex={elapsed < 5 ? 0 : elapsed < 60 ? 1 : 2} startedAt={carousel.job.startedAt} />
          <div className="st-row" style={{ justifyContent: 'center' }}><button type="button" className="st-btn st-btn-ghost" onClick={cancel}><X size={18} />취소하고 돌아가기</button></div></div>
        : failed ? <div className="st-card st-stack"><div className="st-error">{carousel.job.error}</div><button type="button" className="st-btn st-btn-primary" style={{ justifySelf: 'start' }} onClick={() => toStage(carousel.job.stage || carousel.stage, true)}><RotateCcw size={18} />다시 만들기</button></div>
        : !ready ? <HookLoader title="준비 중" stages={GEN_STAGES} stageIndex={0} />
        : carousel.stage === 'cover' ? <CoverStage key={key} carousel={carousel} save={save} />
        : carousel.stage === 'body' ? <BodyStage key={`${key}-${carousel.body.chosen}-${carousel.body.edited ? 'e' : 'o'}`} carousel={carousel} save={save} />
        : carousel.stage === 'slides' ? <SlidesStage key={`${key}-${carousel.slides.template}`} carousel={carousel} save={save} onRedo={() => toStage('slides', true)} />
        : carousel.stage === 'design' ? <DesignStage key={key} carousel={carousel} images={data.images || {}} save={save} />
        : carousel.stage === 'caption' ? <CaptionStage key={`${key}-${carousel.caption.chosen}-${carousel.caption.edited ? 'e' : 'o'}`} carousel={carousel} save={save} />
        : <DoneStage carousel={carousel} images={data.images || {}} />}
      {carousel.stage !== 'done' && !generating && !failed && <div className="st-wizard-foot">
        {idx > 0 && <button type="button" className="st-btn st-btn-ghost st-btn-big" onClick={() => toStage(ORDER[idx - 1])}><ArrowLeft size={20} />이전</button>}
        {ready && carousel.stage !== 'design' && <button type="button" className="st-btn st-btn-ghost st-btn-big" onClick={() => toStage(carousel.stage, true)}><RotateCcw size={18} />다시</button>}
        <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={!ready} onClick={() => toStage(ORDER[idx + 1])}>{NEXT_LABEL[carousel.stage]}<ArrowRight size={20} /></button>
      </div>}
    </div>
    <ChatPanel carousel={carousel} messages={data.messages || []} pending={pending} busy={chatBusy} onSend={send} onApply={apply} appliedId={appliedId} open={chatOpen} setOpen={setChatOpen} />
  </div>
}
