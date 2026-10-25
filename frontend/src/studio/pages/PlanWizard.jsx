import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Mic, Paperclip, RotateCcw, Send, Sparkles, Printer, Save, X, MessageSquareText, ChevronUp, History } from 'lucide-react'
import { useStudio } from '../context'
import { studio, STAGES, SLOT_LABELS } from '../api'
import { apiFetch, parseApiResponse, createApiError } from '../../lib/api'
import HookLoader from '../HookLoader'
import { CopyButton } from './ReferenceDetail'

const ORDER = STAGES.map(([id]) => id)
const GEN_STAGES = ['재료 모으는 중', '훅ai가 쓰는 중', '정리하는 중']
const mergeMessages = (a, b) => { const seen = new Set(a.map(m => m.id)); return [...a, ...b.filter(m => !seen.has(m.id))] }
const chosenOf = f => f ? (f.custom ? { text: f.custom, custom: true } : f.options?.[f.chosen ?? 0]) : null

function useDebouncedSave(fn, delay = 700) {
  const timer = useRef(null)
  return useCallback((...args) => { clearTimeout(timer.current); timer.current = setTimeout(() => fn(...args), delay) }, [fn, delay])
}

const OPTION_NAME = ['A안', 'B안', 'C안', 'D안', 'E안']
// 훅ai sometimes numbers its own labels ("1안: …"); the letter pill already says which one it is.
const optionTitle = label => String(label || '').replace(/^\s*[0-9A-Za-z]\s*안\s*[-:：.]?\s*/, '')

// ---------- chat ----------
const STAGE_NAME = { thumbnail: '썸네일 카피', hook: '첫 문장', script: '대본', caption: '캡션' }
// A 훅ai revision is previewed against the current version: changed lines show old → new, then 이대로 적용.
function ProposalPreview({ proposal, session, applied, onApply }) {
  const current = proposal.stage === 'script' ? (session.script?.edited || session.script?.options?.[session.script?.chosen ?? 0]?.lines || [])
    : proposal.stage === 'caption' ? (session.caption?.edited || session.caption?.options?.[session.caption?.chosen ?? 0])?.text
    : proposal.stage === 'thumbnail' ? (session.thumbnail?.custom || session.thumbnail?.options?.[session.thumbnail?.chosen ?? 0]?.text)
    : (session.hook?.custom || session.hook?.options?.[session.hook?.chosen ?? 0]?.spoken)
  return <div className="st-proposal">
    <strong>{STAGE_NAME[proposal.stage]} 수정안 · {proposal.summary || '미리보기'}</strong>
    {proposal.lines ? <div className="st-proposal-card st-diff">{proposal.lines.map((l, i) => { const before = current[i]?.spoken; const changed = before !== l.spoken
      return <div key={i} className={changed ? 'is-changed' : ''}>{changed && before && <s>{before}</s>}<span>{l.spoken}</span></div> })}
      {current.length > proposal.lines.length && current.slice(proposal.lines.length).map((l, i) => <div key={`d${i}`} className="is-changed"><s>{l.spoken}</s><span className="st-muted st-small">삭제</span></div>)}</div>
      : <div className="st-proposal-card st-diff"><div className="is-changed">{current && current !== proposal.text && <s>{current}</s>}<span>{proposal.text}</span></div>{proposal.hashtags?.length > 0 && <span className="st-muted st-small">{proposal.hashtags.map(t => `#${t}`).join(' ')}</span>}</div>}
    <div className="st-row">{applied ? <span className="st-pill st-pill-green"><Check size={14} /> 적용됨</span> : <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={onApply}><Check size={16} />이 수정 적용</button>}<span className="st-muted st-small">적용 전 버전은 버전 기록에 남아요</span></div>
  </div>
}

function ChatPanel({ session, messages, busy, onSend, onPickTopic, onApply, appliedId, open, setOpen }) {
  const log = useRef(null)
  const [text, setText] = useState('')
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [messages, busy])
  const send = (value) => { const t = (value ?? text).trim(); if (!t || busy) return; setText(''); onSend(t) }
  const last = messages.at(-1)
  return <aside className={`st-chat${open ? ' is-open' : ''}`}>
    <div className="st-chat-head" onClick={() => setOpen(o => !o)}><span className="st-avatar">훅</span>훅ai에게 말하기<button type="button" className="st-icon-btn st-chat-toggle" aria-label="채팅 열기/닫기" style={{ width: 36, height: 36, border: 0 }}><ChevronUp size={18} style={{ transform: open ? 'rotate(180deg)' : 'none' }} /></button></div>
    <div className="st-chat-log" ref={log}>
      {messages.map(m => <div key={m.id} style={{ display: 'contents' }}>
        <div className={`st-msg st-msg-${m.role}`}>{m.content}</div>
        {m.role === 'hookai' && m.meta?.proposals?.length > 0 && session.stage === 'topic' && <div className="st-proposal"><strong>주제 후보예요. 마음에 드는 걸 눌러주세요.</strong>{m.meta.proposals.map((p, i) => <button type="button" key={i} className="st-proposal-card" onClick={() => onPickTopic(p)}><strong>{p.title}</strong><span className="st-muted">{p.promise}</span><span className="st-small" style={{ color: 'var(--st-accent-text)' }}>{p.why}</span></button>)}</div>}
        {m.role === 'hookai' && m.meta?.topic && session.stage === 'topic' && <div className="st-proposal"><strong>이 주제로 갈까요?</strong><div className="st-proposal-card"><strong>{m.meta.topic.title}</strong><span className="st-muted">{m.meta.topic.promise}</span></div><button type="button" className="st-btn st-btn-primary" onClick={() => onPickTopic(m.meta.topic)}><Check size={18} />이 주제로 할게요</button></div>}
        {m.role === 'hookai' && m.meta?.proposal && (m.meta.proposal.stage === session.stage || session.stage === 'done') && session[m.meta.proposal.stage] && <ProposalPreview proposal={m.meta.proposal} session={session} applied={m.id === appliedId} onApply={() => onApply(m.id)} />}
        {m.role === 'hookai' && m === last && m.meta?.chips?.length > 0 && !busy && <div className="st-msg-chips">{m.meta.chips.map(c => <button type="button" key={c} className="st-chip" onClick={() => send(c)}>{c}</button>)}</div>}
      </div>)}
      {busy && <div className="st-chat-typing"><i /><i /><i /></div>}
    </div>
    <form className="st-chat-input" onSubmit={e => { e.preventDefault(); send() }}>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder={session.stage === 'topic' ? '답을 적거나, 원하는 걸 말해주세요' : '고치고 싶은 점을 말해주세요'} rows={1} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} aria-label="훅ai에게 보낼 메시지" />
      <button type="submit" className="st-btn st-btn-primary" disabled={busy || !text.trim()} aria-label="보내기"><Send size={18} /></button>
    </form>
  </aside>
}

// ---------- stage views ----------
function TopicStage({ session, save, onSuggest, onOwnTopic }) {
  const { toast } = useStudio()
  const [brief, setBrief] = useState(session.brief || '')
  const [own, setOwn] = useState('')
  const [attachments, setAttachments] = useState(session.attachments || [])
  const [uploading, setUploading] = useState(false)
  const [listening, setListening] = useState(false)
  const debounced = useDebouncedSave(value => save({ brief: value }))
  const upload = async files => {
    if (!files?.length) return
    setUploading(true)
    try {
      const form = new FormData(); for (const f of files) form.append('files', f)
      const response = await apiFetch('/api/reference-videos/supporting-materials', { method: 'POST', body: form, timeoutMs: 180000 })
      const payload = await parseApiResponse(response)
      if (!response.ok) throw createApiError(response, payload, '첨부파일을 읽지 못했어요.')
      const next = [...attachments, ...payload.items.filter(i => i.status === 'ready').map(i => ({ name: i.name, content: i.content }))].slice(0, 5)
      setAttachments(next); save({ attachments: next })
      for (const i of payload.items.filter(i => i.status !== 'ready')) toast({ kind: 'failed', title: i.name, body: i.error })
    } catch (e) { toast({ kind: 'failed', title: '첨부 실패', body: e.message }) } finally { setUploading(false) }
  }
  const speak = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return toast({ kind: 'failed', title: '이 브라우저는 음성 입력이 안 돼요', body: '크롬이나 사파리에서 써주세요.' })
    const rec = new SR(); rec.lang = 'ko-KR'; rec.interimResults = false
    rec.onresult = e => { const t = e.results[0][0].transcript; setBrief(b => { const v = `${b}${b ? '\n' : ''}${t}`; debounced(v); return v }) }
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false)
    setListening(true); rec.start()
  }
  return <div className="st-stack">
    <section className="st-card st-stack">
      <div><h3>이번 릴스에 담고 싶은 내용</h3><p className="st-muted">제품, 경험, 하고 싶은 말을 편하게 적어주세요. 길어도 괜찮아요. 적은 사실만 기획안에 들어가요.</p></div>
      <textarea className="st-textarea" value={brief} onChange={e => { setBrief(e.target.value); debounced(e.target.value) }} placeholder={'예) 30대 지성 피부인 제가 3주 동안 써본 선크림 3개를 솔직하게 비교하고 싶어요. 제일 좋았던 건 백탁이 없고 오후에도 번들거리지 않던 제품이에요.'} aria-label="이번 릴스에 담고 싶은 내용" />
      <div className="st-row">
        <button type="button" className="st-btn" onClick={speak} disabled={listening}><Mic size={18} />{listening ? '듣는 중…' : '말로 입력'}</button>
        <label className="st-btn" style={{ cursor: 'pointer' }}><Paperclip size={18} />{uploading ? '읽는 중…' : '자료 첨부'}<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx" style={{ display: 'none' }} disabled={uploading} onChange={e => upload([...e.target.files])} /></label>
        <button type="button" className="st-btn st-btn-soft" onClick={() => onSuggest(brief)}><Sparkles size={18} />주제 제안해줘</button>
      </div>
      {attachments.length > 0 && <div className="st-chips">{attachments.map((a, i) => <span key={i} className="st-chip st-btn-sm" style={{ minHeight: 36 }}>{a.name}<button type="button" className="st-icon-btn" style={{ width: 24, height: 24, border: 0 }} aria-label="첨부 삭제" onClick={() => { const next = attachments.filter((_, j) => j !== i); setAttachments(next); save({ attachments: next }) }}><X size={14} /></button></span>)}</div>}
    </section>
    <section className="st-card st-stack" style={{ gap: 10 }}>
      <div><h3>주제가 이미 정해졌다면</h3><p className="st-muted">한 줄로 적고 바로 다음으로 가요. 오른쪽 훅ai와 대화하며 정해도 돼요.</p></div>
      <div className="st-row"><input className="st-input" style={{ flex: 1 }} value={own} onChange={e => setOwn(e.target.value)} placeholder="예) 3주 써본 선크림 3개 솔직 비교" aria-label="주제 직접 입력" /><button type="button" className="st-btn st-btn-primary" disabled={own.trim().length < 2} onClick={() => onOwnTopic(own.trim())}>이 주제로<ArrowRight size={18} /></button></div>
    </section>
  </div>
}

function ThumbnailStage({ session, save }) {
  const t = session.thumbnail
  const [custom, setCustom] = useState(t?.custom || '')
  const debounced = useDebouncedSave(v => save({ thumbnail: { custom: v } }))
  return <div className="st-stack">
    <section className="st-card st-stack"><div><h3>썸네일 카피 3안</h3><p className="st-muted">릴스 커버에 크게 들어갈 제목이에요. 하나를 고르거나 직접 써주세요.</p></div>
      <div className="st-options">{t.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={!t.custom && t.chosen === i} onClick={() => { setCustom(''); save({ thumbnail: { chosen: i } }) }}>
        <div className="st-option-top">{o.label ? <span className="st-pill">{o.label}</span> : <span className="st-pill st-pill-gray">{OPTION_NAME[i]}</span>}<span className="st-option-check"><Check size={16} /></span></div>
        <strong className="st-thumb-text">{o.text}</strong>{o.why && <span className="st-why">{o.why}</span>}</button>)}</div>
      <div className="st-field"><label>직접 쓸게요 <small>적으면 이게 썸네일 카피가 돼요</small></label><input className="st-input" value={custom} onChange={e => { setCustom(e.target.value); debounced(e.target.value) }} placeholder="내가 쓸 썸네일 제목" /></div>
    </section>
  </div>
}

function HookStage({ session, save }) {
  const h = session.hook
  const [custom, setCustom] = useState(h?.custom || '')
  const debounced = useDebouncedSave(v => save({ hook: { custom: v } }))
  return <section className="st-card st-stack"><div><h3>첫 문장 3안</h3><p className="st-muted">영상 첫 3초에 말할 문장이에요. 썸네일이 한 약속을 이어받아요.</p></div>
    <div className="st-options">{h.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={!h.custom && h.chosen === i} onClick={() => { setCustom(''); save({ hook: { chosen: i } }) }}>
      <div className="st-option-top"><span className="st-pill">{o.type}</span><span className="st-option-check"><Check size={16} /></span></div><strong>“{o.spoken}”</strong><span className="st-why">자막 · {o.onScreen} — {o.why}</span></button>)}</div>
    <div className="st-field"><label>직접 쓸게요</label><input className="st-input" value={custom} onChange={e => { setCustom(e.target.value); debounced(e.target.value) }} placeholder="내가 쓸 첫 문장" /></div>
  </section>
}

// 저장 내역: every version of the script or caption, newest first, with the whole text so a student can read before loading one.
const when = value => value ? new Date(value).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''
function HistoryModal({ title, versions, onClose }) {
  return <div className="st-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="st-modal-box st-versions" role="dialog" aria-label={`${title} 저장 내역`}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><div><h2><History size={22} /> 저장 내역</h2><p className="st-muted">저장된 버전을 보고 원하는 것을 불러올 수 있어요.</p></div><button type="button" className="st-icon-btn" aria-label="닫기" onClick={onClose}><X size={20} /></button></div>
      {versions.map((v, i) => <article className="st-version" key={i}>
        <div className="st-version-head">
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}><strong>버전 {versions.length - i}</strong>{i === 0 && <span className="st-pill st-pill-green">최신</span>}{v.note && <span className="st-pill st-pill-gray">{v.note}</span>}</div>
          {i === 0 ? <span className="st-muted st-small">지금 보고 있는 버전</span> : <button type="button" className="st-btn st-btn-sm" onClick={() => { v.load(); onClose() }}><RotateCcw size={15} />불러오기</button>}
        </div>
        <div className="st-muted st-small">{when(v.at)}{v.at ? ' · ' : ''}{v.text.replace(/\s+/g, '').length} 글자</div>
        <pre className="st-version-text">{v.text}</pre>
      </article>)}
    </div>
  </div>
}
const scriptText = lines => (lines || []).map(l => l.spoken).join('\n')
const captionText = c => c ? `${c.text || ''}${c.hashtags?.length ? `\n\n${c.hashtags.map(t => `#${t}`).join(' ')}` : ''}` : ''

// Line editor shared by the 대본 stage and the finished plan: sentences, captions and seconds are editable in place.
function ScriptEditor({ session, save, onQuick, title = '대본' }) {
  const s = session.script
  const [lines, setLines] = useState(s.edited || s.options[s.chosen ?? 0]?.lines || [])
  const debounced = useDebouncedSave(v => save({ script: { edited: v } }))
  const edit = (i, patch) => setLines(ls => { const next = ls.map((l, j) => j === i ? { ...l, ...patch } : l); debounced(next); return next })
  const total = lines.reduce((sum, l) => sum + (l.seconds || 0), 0)
  const [showHistory, setShowHistory] = useState(false)
  const versions = [{ note: s.edited ? '직접 수정' : OPTION_NAME[s.chosen ?? 0], at: session.updatedAt, text: scriptText(lines) },
    ...(s.history || []).map((h, i) => ({ note: h.note, at: h.at, text: scriptText(h.value), load: () => save({ script: { restore: i } }) }))]
  return <section className="st-card st-stack">
    <div className="st-card-head"><h3>{title} <span className="st-pill st-pill-gray" style={{ marginLeft: 6 }}>예상 {total}초</span></h3><div className="st-row"><CopyButton text={lines.map(l => l.spoken).join('\n')} />{s.history?.length > 0 && <button type="button" className="st-btn st-btn-sm" onClick={() => setShowHistory(true)}><History size={15} />저장 내역 · {s.history.length + 1}</button>}{s.edited && <button type="button" className="st-btn st-btn-sm" onClick={() => save({ script: { chosen: s.chosen ?? 0 } })}><RotateCcw size={15} />원래대로</button>}</div></div>
    <p className="st-muted st-small">문장을 눌러 바로 고칠 수 있어요. 고치면 자동으로 저장돼요. 초는 훅ai가 잡은 예상 길이예요.</p>
    <div className="st-lines">{lines.map((l, i) => <div className="st-line" key={i}>
      <div className="st-line-part"><small>{l.seconds}초</small></div>
      <div><textarea value={l.spoken} rows={Math.max(1, Math.ceil(l.spoken.length / 34))} onChange={e => edit(i, { spoken: e.target.value })} aria-label={`${i + 1}번째 문장`} /></div>
      <button type="button" className="st-icon-btn" style={{ width: 36, height: 36 }} aria-label="이 문장 삭제" onClick={() => setLines(ls => { const next = ls.filter((_, j) => j !== i); debounced(next); return next })}><X size={16} /></button>
    </div>)}</div>
    {onQuick && <div className="st-quick">{['첫 문장 더 세게', '더 짧게', '더 길게', '더 친근하게', '마무리 멘트 바꾸기'].map(q => <button type="button" key={q} className="st-chip st-chip-soft" onClick={() => onQuick(q)}>{q}</button>)}</div>}
    {showHistory && <HistoryModal title="대본" versions={versions} onClose={() => setShowHistory(false)} />}
  </section>
}

function ScriptStage({ session, save, onQuick }) {
  const s = session.script
  return <div className="st-stack">
    <section className="st-card st-stack"><div><h3>대본 3안</h3><p className="st-muted">같은 첫 문장, 다른 흐름이에요. 전체 대본을 비교해서 하나를 고르면 아래에서 바로 고칠 수 있어요.</p></div>
      <div className="st-options st-options-scripts">{s.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={s.chosen === i} onClick={() => save({ script: { chosen: i } })}>
        <div className="st-option-top"><span className="st-pill">{OPTION_NAME[i]}</span><span className="st-muted st-small">예상 {o.lines.reduce((a, l) => a + l.seconds, 0)}초</span><span className="st-option-check"><Check size={16} /></span></div>
        <strong style={{ fontSize: 16 }}>{optionTitle(o.label)}</strong>
        <ol className="st-option-lines">{o.lines.map((l, j) => <li key={j}>{l.spoken}</li>)}</ol>
        <span className="st-why">{o.why}</span></button>)}</div></section>
    <ScriptEditor session={session} save={save} onQuick={onQuick} />
  </div>
}

function FilmingStage({ session, save }) {
  const f = session.filming
  const [memo, setMemo] = useState(session.memo || '')
  const [checked, setChecked] = useState({})
  const debounced = useDebouncedSave(v => save({ memo: v }))
  return <div className="st-stack">
    <section className="st-card st-stack"><div className="st-card-head"><h3>촬영 · 스토리보드 <span className="st-muted st-small">· {f.storyboard.length}컷</span></h3></div>
      <ol className="st-board">{f.storyboard.map(s => <li key={s.scene}><div className="st-board-top"><strong>#{s.scene}</strong><span>{s.seconds}초</span></div><strong>{s.shot}</strong><span>{s.action}</span>{s.onScreen && <span className="st-on">{s.onScreen}</span>}{s.spoken && <span className="st-muted">“{s.spoken}”</span>}</li>)}</ol></section>
    <section className="st-card"><div className="st-kv"><span>장소</span><div>{f.location}</div></div>{f.props?.length > 0 && <div className="st-kv"><span>준비물</span><div className="st-chips">{f.props.map(p => <span key={p} className="st-pill st-pill-gray" style={{ fontSize: 15 }}>{p}</span>)}</div></div>}<div className="st-kv"><span>카메라</span><div>{f.camera}</div></div><div className="st-kv"><span>조명</span><div>{f.lighting}</div></div><div className="st-kv"><span>편집</span><div>{f.editing}</div></div></section>
    {f.editingPlan && <section className="st-card st-stack"><div className="st-card-head"><h3>편집</h3><p>자막·컷·효과·사운드</p></div><div className="st-kv"><span>자막 스타일</span><div>{f.editingPlan.subtitleStyle}</div></div><div className="st-kv"><span>컷·템포</span><div>{f.editingPlan.cuts}</div></div><div className="st-kv"><span>전환</span><div>{f.editingPlan.transitions}</div></div><div className="st-kv"><span>효과</span><div>{f.editingPlan.effects}</div></div><div className="st-kv"><span>사운드</span><div>{f.editingPlan.sound}</div></div>
      {f.editingPlan.checklist?.length > 0 && <ul className="st-check">{f.editingPlan.checklist.map((c, i) => <li key={`e${i}`}><label><input type="checkbox" checked={!!checked[`e${i}`]} onChange={e => setChecked(p => ({ ...p, [`e${i}`]: e.target.checked }))} /><span>{c}</span></label></li>)}</ul>}</section>}
    {f.checklist?.length > 0 && <section className="st-card st-stack"><h3>촬영 전 체크</h3><ul className="st-check">{f.checklist.map((c, i) => <li key={i}><label><input type="checkbox" checked={!!checked[i]} onChange={e => setChecked(p => ({ ...p, [i]: e.target.checked }))} /><span>{c}</span></label></li>)}</ul></section>}
    <section className="st-card st-stack" style={{ gap: 8 }}><h3>내 메모</h3><p className="st-muted st-small">촬영 장소, 준비물, 아이디어를 적어두세요. 기획안에 같이 저장돼요.</p><textarea className="st-textarea" style={{ minHeight: 110 }} value={memo} onChange={e => { setMemo(e.target.value); debounced(e.target.value) }} placeholder="예) 토요일 오전 창가에서 촬영, 링라이트 빌리기" aria-label="촬영 메모" /></section>
  </div>
}

function CaptionStage({ session, save }) {
  const c = session.caption
  const current = c.edited || c.options[c.chosen ?? 0]
  const [text, setText] = useState(current.text)
  const [tags, setTags] = useState((current.hashtags || []).map(t => `#${t}`).join(' '))
  const debounced = useDebouncedSave((t, h) => save({ caption: { edited: { text: t, hashtags: h.split(/[\s,]+/).map(x => x.replace(/^#/, '')).filter(Boolean) } } }))
  const [showHistory, setShowHistory] = useState(false)
  const versions = [{ note: c.edited ? '직접 수정' : OPTION_NAME[c.chosen ?? 0], at: session.updatedAt, text: captionText({ text, hashtags: tags.split(/[\s,]+/).map(x => x.replace(/^#/, '')).filter(Boolean) }) },
    ...(c.history || []).map((h, i) => ({ note: h.note, at: h.at, text: captionText(h.value), load: () => save({ caption: { restore: i } }) }))]
  return <div className="st-stack">
    <section className="st-card st-stack"><div><h3>캡션 3안</h3><p className="st-muted">하나를 고르고 아래에서 고쳐요.</p></div>
      <div className="st-options">{c.options.map((o, i) => <button type="button" key={i} className="st-option" aria-pressed={!c.edited && c.chosen === i} onClick={() => save({ caption: { chosen: i } })}><div className="st-option-top"><span className="st-pill">{OPTION_NAME[i]}</span><span className="st-option-check"><Check size={16} /></span></div><strong style={{ fontSize: 16, whiteSpace: 'pre-wrap' }}>{o.text}</strong><span className="st-why">{o.why}</span></button>)}</div></section>
    <section className="st-card st-stack"><div className="st-card-head"><h3>캡션</h3><div className="st-row"><CopyButton text={`${text}\n\n${tags.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}`} />{c.history?.length > 0 && <button type="button" className="st-btn st-btn-sm" onClick={() => setShowHistory(true)}><History size={15} />저장 내역 · {c.history.length + 1}</button>}</div></div>
      <textarea className="st-textarea" value={text} onChange={e => { setText(e.target.value); debounced(e.target.value, tags) }} aria-label="캡션 본문" />
      <div className="st-field"><label>해시태그</label><input className="st-input" value={tags} onChange={e => { setTags(e.target.value); debounced(text, e.target.value) }} placeholder="#선크림추천 #지성피부" /></div>
      {showHistory && <HistoryModal title="캡션" versions={versions} onClose={() => setShowHistory(false)} />}</section>
  </div>
}

function DoneStage({ session, onSaveFormula, save, version }) {
  const { go } = useStudio()
  const thumb = chosenOf(session.thumbnail), hook = chosenOf(session.hook)
  const cap = session.caption?.edited || chosenOf(session.caption)
  return <div className="st-stack">
    <div className="st-note" style={{ fontSize: 17 }}>👏 기획안이 완성됐어요. 아래에서 한눈에 보고, 마음에 드는 공식은 저장해 두세요.</div>
    <div className="st-row"><button type="button" className="st-btn st-btn-primary st-btn-big" onClick={() => go('print', { session: session.id })}><Printer size={20} />PDF로 받기 · 인쇄</button><button type="button" className="st-btn st-btn-big" onClick={() => go('new')}><Sparkles size={20} />새 기획안</button></div>
    <section className="st-card st-stack"><div className="st-card-head"><h3>썸네일 카피</h3><div className="st-row"><CopyButton text={thumb?.text} /></div></div><strong style={{ fontSize: 22 }}>{thumb?.text}</strong></section>
    <section className="st-card st-stack"><div className="st-card-head"><h3>첫 문장</h3><div className="st-row"><CopyButton text={hook?.spoken || hook?.text} /><button type="button" className="st-btn st-btn-sm" onClick={() => onSaveFormula('hook')}><Save size={15} />이 공식 저장</button></div></div><strong style={{ fontSize: 18 }}>“{hook?.spoken || hook?.text}”</strong></section>
    <div className="st-row" style={{ justifyContent: 'flex-end', marginBottom: -8 }}><button type="button" className="st-btn st-btn-sm" onClick={() => onSaveFormula('structure')}><Save size={15} />전개 공식 저장</button></div>
    <ScriptEditor key={`${version}-${session.script?.chosen}-${session.script?.edited ? 'e' : 'o'}-${session.script?.history?.length || 0}`} session={session} save={save} />
    {session.filming && <section className="st-card st-stack"><div className="st-card-head"><h3>촬영/편집</h3><button type="button" className="st-btn st-btn-sm" onClick={() => onSaveFormula('filming')}><Save size={15} />촬영/편집 공식 저장</button></div><ol className="st-board">{session.filming.storyboard.map(s => <li key={s.scene}><div className="st-board-top"><strong>#{s.scene}</strong><span>{s.seconds}초</span></div><strong>{s.shot}</strong><span>{s.action}</span></li>)}</ol>{session.memo && <p className="st-muted" style={{ whiteSpace: 'pre-wrap' }}>메모: {session.memo}</p>}</section>}
    {session.filming?.editingPlan && <section className="st-card st-stack"><div className="st-card-head"><h3>편집</h3></div><div className="st-kv"><span>자막</span><div>{session.filming.editingPlan.subtitleStyle}</div></div><div className="st-kv"><span>컷·템포</span><div>{session.filming.editingPlan.cuts}</div></div><div className="st-kv"><span>효과</span><div>{session.filming.editingPlan.effects}</div></div><div className="st-kv"><span>사운드</span><div>{session.filming.editingPlan.sound}</div></div></section>}
    {cap && <section className="st-card st-stack"><div className="st-card-head"><h3>캡션</h3><div className="st-row"><CopyButton text={`${cap.text}\n\n${(cap.hashtags || []).map(t => `#${t}`).join(' ')}`} /><button type="button" className="st-btn st-btn-sm" onClick={() => onSaveFormula('caption')}><Save size={15} />캡션 공식 저장</button></div></div><p style={{ whiteSpace: 'pre-wrap' }}>{cap.text}</p><p style={{ color: 'var(--st-accent-text)' }}>{(cap.hashtags || []).map(t => `#${t}`).join(' ')}</p></section>}
    {session.placeholders?.length > 0 && <div className="st-note st-note-warn">촬영 전에 채워 주세요: {session.placeholders.map(p => <span key={p} className="st-blank" style={{ marginLeft: 6 }}>{p}</span>)}</div>}
  </div>
}

function AskCard({ ask, onAnswer, busy }) {
  const [text, setText] = useState('')
  const q = ask.questions[ask.index]
  return <section className="st-card st-stack" style={{ borderColor: 'var(--st-accent-soft-2)' }}>
    <div className="st-row"><span className="st-avatar" style={{ width: 38, height: 38, borderRadius: 999, background: 'var(--st-accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 900 }}>훅</span><div><h3>훅ai가 먼저 물어봐요</h3><p className="st-muted st-small">지어내지 않으려고요. 답을 받으면 바로 만들어요. ({ask.index + 1}/{ask.questions.length})</p></div></div>
    <p style={{ fontSize: 19, fontWeight: 700 }}>{q.question}</p>
    {q.chips?.length > 0 && <div className="st-chips">{q.chips.map(c => <button type="button" key={c} className="st-chip" disabled={busy} onClick={() => onAnswer(c)}>{c}</button>)}</div>}
    <form className="st-row" onSubmit={e => { e.preventDefault(); if (text.trim()) { onAnswer(text.trim()); setText('') } }}>
      <input className="st-input" style={{ flex: 1 }} value={text} onChange={e => setText(e.target.value)} placeholder="여기에 답을 적어주세요" aria-label="답변" disabled={busy} />
      <button type="submit" className="st-btn st-btn-primary" disabled={busy || !text.trim()}>답하기<ArrowRight size={18} /></button>
    </form>
  </section>
}

// ---------- wizard ----------
export default function PlanWizard({ sessionId }) {
  const { go, toast } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [version, setVersion] = useState(0)
  const [appliedId, setAppliedId] = useState(null)
  const session = data?.session
  const load = useCallback(() => studio.session(sessionId).then(setData).catch(e => setError(e.message)), [sessionId])
  useEffect(() => { load() }, [load])
  const running = session?.job?.status === 'running'
  useEffect(() => { if (!running) return undefined; const t = setInterval(load, 3000); return () => clearInterval(t) }, [running, load])

  const save = useCallback(async patch => { try { const r = await studio.patchSession(sessionId, patch); setData(d => ({ ...d, session: r.session })) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) } }, [sessionId, toast])
  const send = async (text, { openChat = true } = {}) => {
    setChatBusy(true); if (openChat) setChatOpen(true)
    try { const r = await studio.chat(sessionId, text); setData(d => ({ ...d, messages: mergeMessages(d.messages, r.messages) })); load() }
    catch (e) { toast({ kind: 'failed', title: '훅ai가 답하지 못했어요', body: e.message }) } finally { setChatBusy(false) }
  }
  const pickTopic = async topic => { setChatOpen(false); try { const r = await studio.setTopic(sessionId, topic); setData(d => ({ ...d, session: r.session })); load() } catch (e) { toast({ kind: 'failed', title: '주제를 정하지 못했어요', body: e.message }) } }
  const toStage = async (stage, regenerate = false) => { setChatOpen(false); try { const r = await studio.stage(sessionId, stage, regenerate); setData(d => ({ ...d, session: r.session })); setVersion(v => v + 1); load(); window.scrollTo(0, 0) } catch (e) { toast({ kind: 'failed', title: '이동하지 못했어요', body: e.message }) } }
  const apply = async messageId => { try { const r = await studio.apply(sessionId, messageId); setData(d => ({ ...d, session: r.session })); setVersion(v => v + 1); setAppliedId(messageId); toast({ kind: 'ready', title: '적용했어요', body: '화면에 반영됐어요.' }) } catch (e) { toast({ kind: 'failed', title: '적용 실패', body: e.message }) } }
  const saveFormula = async kind => { try { const r = await studio.saveFormula({ kind, sessionId }); toast({ kind: 'ready', title: '내 공식에 저장했어요', body: r.formula.title, action: { label: '내 공식 보기', onClick: () => go('formulas') } }) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) } }

  if (error) return <div className="st-error">{error}</div>
  if (!session) return <p className="st-muted">불러오는 중…</p>
  const idx = ORDER.indexOf(session.stage)
  const hasTopic = Boolean(session.topic?.title)
  const stageReady = session.stage === 'topic' ? hasTopic : session.stage === 'done' ? true : Boolean(session[session.stage])
  const failed = session.job?.status === 'failed'
  const generating = running && session.job?.stage === session.stage
  const elapsed = session.job?.startedAt ? (Date.now() - Date.parse(session.job.startedAt)) / 1000 : 0
  const nextLabel = { topic: '썸네일 카피 만들기', thumbnail: '첫 문장 만들기', hook: '대본 만들기', script: '촬영·편집 기획', filming: '캡션 만들기', caption: '완성하기' }[session.stage]
  return <div className="st-wizard">
    <div className="st-wizard-main">
      <div className="st-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="st-btn st-btn-ghost" onClick={() => go('plans')}><ArrowLeft size={20} />내 기획안</button>
        {hasTopic && <strong className="st-muted st-wizard-title" style={{ fontSize: 15 }}>{session.topic.title}</strong>}
        <button type="button" className="st-btn st-btn-ghost st-chat-toggle" onClick={() => setChatOpen(o => !o)}><MessageSquareText size={18} />훅ai</button>
      </div>
      <nav className="st-stepper" aria-label="기획 단계">{STAGES.map(([id, label], i) => <span key={id} style={{ display: 'contents' }}>{i > 0 && <span className="st-step-gap" />}<button type="button" className={`st-step${i < idx ? ' is-done' : ''}`} aria-current={id === session.stage ? 'step' : undefined} disabled={i > idx} onClick={() => i < idx && toStage(id)}><i>{i < idx ? <Check size={15} /> : i + 1}</i>{label}</button></span>)}</nav>
      {Object.keys(session.sources || {}).length > 0 && data.sources && <div className="st-chips">{Object.entries(data.sources).map(([slot, s]) => <span key={slot} className="st-pill st-pill-gray" style={{ fontSize: 14 }}>{SLOT_LABELS[slot]} · {s.label}</span>)}</div>}
      {session.ask && session.ask.stage === session.stage && !generating ? <AskCard ask={session.ask} busy={chatBusy} onAnswer={a => send(a, { openChat: false })} />
        : generating ? <HookLoader title={`훅ai가 ${STAGES.find(([id]) => id === session.stage)?.[1]} 만드는 중`} stages={GEN_STAGES} stageIndex={elapsed < 5 ? 0 : elapsed < 60 ? 1 : 2} startedAt={session.job.startedAt} />
        : failed ? <div className="st-card st-stack"><div className="st-error">{session.job.error}</div><button type="button" className="st-btn st-btn-primary" onClick={() => toStage(session.stage, true)}><RotateCcw size={18} />다시 만들기</button></div>
        : session.stage === 'topic' ? <TopicStage session={session} save={save} onSuggest={brief => send(brief ? `주제 제안해줘. 내용: ${brief.slice(0, 1500)}` : '주제 제안해줘')} onOwnTopic={title => pickTopic({ title, category: session.topic?.category || '기타', facts: [] })} />
        : !stageReady ? (failed ? null : <HookLoader title="준비 중" stages={GEN_STAGES} stageIndex={0} />)
        : session.stage === 'thumbnail' ? <ThumbnailStage session={session} save={save} />
        : session.stage === 'hook' ? <HookStage session={session} save={save} />
        : session.stage === 'script' ? <ScriptStage key={`${version}-${session.script.chosen}-${session.script.edited ? 'e' : 'o'}-${session.script.history?.length || 0}`} session={session} save={save} onQuick={send} />
        : session.stage === 'filming' ? <FilmingStage session={session} save={save} />
        : session.stage === 'caption' ? <CaptionStage key={`${version}-${session.caption.chosen}-${session.caption.edited ? 'e' : 'o'}-${session.caption.history?.length || 0}`} session={session} save={save} />
        : <DoneStage session={session} onSaveFormula={saveFormula} save={save} version={version} />}
      {session.placeholders?.length > 0 && session.stage !== 'done' && session.stage !== 'topic' && <div className="st-note st-note-warn st-small">촬영 전에 채울 빈칸: {session.placeholders.join(', ')}</div>}
      {session.stage !== 'done' && !generating && <div className="st-wizard-foot">
        {idx > 0 && <button type="button" className="st-btn st-btn-ghost st-btn-big" onClick={() => toStage(ORDER[idx - 1])}><ArrowLeft size={20} />이전</button>}
        {session.stage !== 'topic' && stageReady && <button type="button" className="st-btn st-btn-ghost st-btn-big" onClick={() => toStage(session.stage, true)}><RotateCcw size={18} />다시</button>}
        {session.stage === 'topic' ? <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={!hasTopic} onClick={() => toStage('thumbnail')}>{hasTopic ? `${nextLabel}` : '먼저 주제를 정해주세요'}<ArrowRight size={20} /></button>
          : <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={!stageReady} onClick={() => toStage(ORDER[idx + 1])}>{nextLabel}<ArrowRight size={20} /></button>}
      </div>}
    </div>
    <ChatPanel session={session} messages={data.messages} busy={chatBusy} onSend={send} onPickTopic={pickTopic} onApply={apply} appliedId={appliedId} open={chatOpen} setOpen={setChatOpen} />
  </div>
}
