import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Star, Sparkles, Trash2, Plus, ArrowRight, Check, Lightbulb, FileText, Paperclip, X, LoaderCircle } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount } from '../api'
import HookAvatar from '../HookAvatar'
import ChatWaitLine from '../ChatWait'
import { apiFetch, parseApiResponse, createApiError } from '../../lib/api'

// 주제 찾기: talk with 훅ai only about the topic, save the good ones to 주제 보관함, and start a plan from a saved topic.
const STARTERS = ['제 제품·서비스로 주제를 찾고 싶어요', '제 경험·일상으로 주제를 찾고 싶어요', '요즘 터지는 주제로 추천해 주세요']
// The prompt asks for material a creator has (a product, something lived through, something known well): topics come from it.
const START_PLACEHOLDER = '어떤 걸 찍어 보고 싶으세요? 소개하고 싶은 제품, 직접 겪은 일, 잘 아는 것 무엇이든 좋아요'
const sameCard = (a, b) => a.title === b.title
const FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.docx'

// 📎 in the conversation: files are read into text by the studio and sent along with the next message.
function AttachButton({ uploading, onFiles }) {
  return <label className="st-icon-btn st-attach-btn" title="파일 올리기 (PDF·이미지·텍스트·워드, 5개까지)" aria-label="파일 올리기">
    {uploading ? <LoaderCircle size={18} className="st-spin" /> : <Paperclip size={18} />}
    <input type="file" multiple accept={FILE_TYPES} style={{ display: 'none' }} disabled={uploading} onChange={e => { onFiles([...e.target.files]); e.target.value = '' }} />
  </label>
}
function AttachChips({ items, onRemove }) {
  if (!items.length) return null
  return <div className="st-attach-chips">{items.map((a, i) => <span key={`${a.name}-${i}`} className="st-chip"><Paperclip size={13} />{a.name}{onRemove && <button type="button" aria-label="빼기" onClick={() => onRemove(i)}><X size={13} /></button>}</span>)}</div>
}

function IdeaCard({ card, saved, onSave, onPlan, onAsk }) {
  const { go } = useStudio()
  return <article className="st-idea-card">
    <header className="st-idea-top">{card.category && <span className="st-pill">{card.category}</span>}<h4>{card.title}</h4></header>
    {/* One label per line, its answer under it, so each piece reads on its own. */}
    <dl className="st-idea-facts">
      {card.angle && <div><dt>다른 영상과 다른 점</dt><dd>{card.angle}</dd></div>}
      {card.promise && <div><dt>시청자가 얻는 것</dt><dd>{card.promise}</dd></div>}
      {card.why && <div><dt><Lightbulb size={14} />지금 먹히는 이유</dt><dd>{card.why}</dd></div>}
      {card.materials?.length > 0 && <div><dt>찍으려면 필요한 것</dt><dd><ul>{card.materials.map(m => <li key={m}>{m}</li>)}</ul></dd></div>}
      {card.reels?.length > 0 && <div><dt>이 분야에서 터진 영상</dt><dd className="st-idea-reels">{card.reels.map(r => <button type="button" key={r.id} onClick={() => go('reference', { ref: r.id })} title={`@${r.username}`}>
        {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" loading="lazy" /> : <span className="st-idea-reel-empty" />}<small>▶ {compactCount(r.views)}</small></button>)}</dd></div>}
    </dl>
    <div className="st-idea-actions">
      <button type="button" className={`st-btn st-btn-sm${saved ? '' : ' st-btn-primary'}`} disabled={saved} onClick={onSave}>{saved ? <><Check size={16} />보관함에 저장됨</> : <><Star size={16} />이 주제 저장</>}</button>
      <button type="button" className="st-btn st-btn-sm" onClick={onPlan}><FileText size={16} />이 주제로 기획안 만들기</button>
      <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => onAsk(`'${card.title}' 더 구체적으로 좁혀줘`)}>더 구체적으로</button>
      <button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => onAsk(`'${card.title}' 다른 방향으로 풀어줘`)}>다른 방향으로</button>
    </div>
  </article>
}

function SavedTopic({ item, onPlan, onRemove, onMemo }) {
  const { go } = useStudio()
  const [memo, setMemo] = useState(item.memo || '')
  return <article className="st-saved-topic">
    <div className="st-row" style={{ gap: 6 }}>{item.category && <span className="st-pill st-pill-gray">{item.category}</span>}{item.sessionId && <span className="st-pill st-pill-green">기획안 만듦</span>}</div>
    <strong>{item.title}</strong>
    {item.angle && <p className="st-muted st-small">{item.angle}</p>}
    <textarea className="st-textarea" rows={2} value={memo} placeholder="메모(찍을 때 떠오른 것, 쓸 소품 등)" onChange={e => setMemo(e.target.value)} onBlur={() => memo !== (item.memo || '') && onMemo(memo)} />
    <div className="st-row" style={{ gap: 6 }}>
      {item.sessionId ? <button type="button" className="st-btn st-btn-sm" onClick={() => go('plan', { session: item.sessionId })}>기획안 열기<ArrowRight size={15} /></button>
        : <button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={onPlan}>기획안 만들기<ArrowRight size={15} /></button>}
      <button type="button" className="st-icon-btn" aria-label="삭제" onClick={onRemove}><Trash2 size={16} /></button>
    </div>
  </article>
}

export default function IdeasPage({ threadId: initialThread }) {
  const { go, toast } = useStudio()
  const [threads, setThreads] = useState([])
  const [saved, setSaved] = useState([])
  const [threadId, setThreadId] = useState(initialThread || null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const log = useRef(null)
  const loadList = useCallback(() => studio.ideas().then(d => { setThreads(d.threads || []); setSaved(d.saved || []) }).catch(() => {}), [])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (!threadId) { setMessages([]); return } studio.ideaThread(threadId).then(d => setMessages(d.messages || [])).catch(e => toast({ kind: 'failed', title: '대화를 불러오지 못했어요', body: e.message })) }, [threadId, toast])
  // The conversation scrolls with the page (the input stays pinned at the bottom), so the page follows the newest message.
  useEffect(() => { if (log.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }) }, [messages, pending, busy])

  const upload = async picked => {
    if (!picked.length) return
    setUploading(true)
    try {
      const form = new FormData(); picked.slice(0, 5).forEach(f => form.append('files', f))
      const response = await apiFetch('/api/creator-tools/studio/materials', { method: 'POST', body: form, timeoutMs: 180000 })
      const payload = await parseApiResponse(response)
      if (!response.ok) throw createApiError(response, payload, '파일을 읽지 못했어요.')
      setFiles(f => [...f, ...payload.items.filter(i => i.status === 'ready').map(i => ({ name: i.name, content: i.content }))].slice(0, 5))
      for (const i of payload.items.filter(i => i.status !== 'ready')) toast({ kind: 'failed', title: i.name, body: i.error })
    } catch (e) { toast({ kind: 'failed', title: '파일을 올리지 못했어요', body: e.message }) } finally { setUploading(false) }
  }
  // 훅ai answers in the background; the conversation is checked every 2 s until the answer to this message is in.
  const send = async value => {
    const t = (value ?? text).trim(), attached = files
    if ((!t && !attached.length) || busy || uploading) return
    setText(''); setFiles([]); setBusy(true); setPending(t || `자료 ${attached.length}개를 올렸어요`)
    try {
      const r = threadId ? await studio.ideaChat(threadId, t, attached) : await studio.ideaStart(t, attached)
      const id = threadId || r.thread.id
      if (!threadId) { setThreadId(id); go('ideas', { thread: id }, { replace: true }) }
      setMessages(m => [...m, ...r.messages]); setPending(null)
      const mine = r.messages[0].id, until = Date.now() + 8 * 60000
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 2000))
        const d = await studio.ideaThread(id).catch(() => null)
        const reply = d?.messages.slice(d.messages.findIndex(m => m.id === mine) + 1).find(m => m.role === 'hookai')
        if (d) setMessages(d.messages)
        if (reply) { if (reply.meta?.failed) toast({ kind: 'failed', title: '훅ai가 답하지 못했어요', body: '같은 말을 한 번만 다시 보내주세요.' }); break }
        if (Date.now() > until) { toast({ kind: 'failed', title: '답이 늦어지고 있어요', body: '잠시 뒤 다시 열면 답이 보일 거예요.' }); break }
      }
      loadList()
    } catch (e) { setText(t); setFiles(attached); toast({ kind: 'failed', title: '훅ai가 답하지 못했어요', body: e.message }) } finally { setBusy(false); setPending(null) }
  }
  const saveCard = async card => {
    try { const r = await studio.saveIdea(threadId, card); setSaved(s => [r.saved, ...s]); toast({ kind: 'ready', title: '주제 보관함에 저장했어요', body: card.title }); return r.saved }
    catch (e) { toast({ kind: 'failed', title: '저장하지 못했어요', body: e.message }); return null }
  }
  const planFrom = async item => {
    try { const r = await studio.planFromIdea(item.id); go('plan', { session: r.session.id }) } catch (e) { toast({ kind: 'failed', title: '기획안을 만들지 못했어요', body: e.message }) }
  }
  const newThread = () => { setThreadId(null); setMessages([]); go('ideas', {}, { replace: true }) }
  const last = messages.at(-1)
  const starting = !threadId && !messages.length && !pending && !busy
  const savedPanel = <aside className="st-card st-ideas-saved" data-tour="ideas-saved">
    <h3><Star size={18} /> 주제 보관함 <span className="st-muted st-small">· {saved.length}</span></h3>
    {!saved.length ? <p className="st-muted st-small">마음에 드는 주제 카드에서 [이 주제 저장]을 누르면 여기에 모여요. 나중에 기획안 만들 때 꺼내 쓸 수 있어요.</p>
      : saved.map(item => <SavedTopic key={item.id} item={item} onPlan={() => planFrom(item)}
        onRemove={async () => { try { await studio.removeIdea(item.id); setSaved(s => s.filter(x => x.id !== item.id)) } catch (e) { toast({ kind: 'failed', title: '지우지 못했어요', body: e.message }) } }}
        onMemo={async memo => { try { const r = await studio.updateIdea(item.id, { memo }); setSaved(s => s.map(x => x.id === item.id ? r.saved : x)) } catch { /* the memo stays as typed */ } }} />)}
  </aside>

  // Before any conversation: a clean start like a chat app's home, no boxes, the input in the middle.
  if (starting) return <div className={`st-ideas st-ideas-home${saved.length ? '' : ' is-alone'}`}>
    <section className="st-ideas-start">
      <div className="st-ideas-hero"><HookAvatar size={64} /><h2>좋은 기획안은 구체적인 주제에서 시작해요</h2></div>
      <p className="st-muted">팔고 싶은 것, 보여주고 싶은 것, 요즘 고민, 막연한 관심사도 괜찮아요. 훅ai가 하나씩 물어보면서 찍을 수 있을 만큼 구체적인 주제로 좁혀 드려요.</p>
      <form className="st-ideas-composer" onSubmit={e => { e.preventDefault(); send() }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder={START_PLACEHOLDER} aria-label="훅ai에게 보낼 메시지"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} />
        <AttachChips items={files} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
        <div className="st-ideas-composer-foot">
          <div className="st-row" style={{ gap: 4 }}><AttachButton uploading={uploading} onFiles={upload} />
          {threads.length > 0 ? <select className="st-input st-ideas-threads" value="" onChange={e => e.target.value && setThreadId(e.target.value)} aria-label="지난 대화">
            <option value="">지난 대화 열기</option>{threads.map(t => <option key={t.id} value={t.id}>{t.title || '제목 없는 대화'}</option>)}</select> : null}</div>
          <button type="submit" className="st-btn st-btn-primary" disabled={(!text.trim() && !files.length) || uploading} aria-label="보내기"><Send size={18} /></button>
        </div>
      </form>
      <div className="st-ideas-starters">{STARTERS.map(s => <button type="button" key={s} className="st-chip" onClick={() => send(s)}><Sparkles size={15} />{s}</button>)}</div>
    </section>
    {saved.length > 0 && savedPanel}
  </div>

  return <div className="st-ideas">
    <section className="st-ideas-chat">
      <div className="st-ideas-head">
        <div className="st-row" style={{ gap: 10 }}><HookAvatar size={36} /><strong>훅ai와 주제 찾기</strong></div>
        <div className="st-row" style={{ gap: 8 }}>
          {threads.length > 0 && <select className="st-input st-ideas-threads" value={threadId || ''} onChange={e => e.target.value ? setThreadId(e.target.value) : newThread()} aria-label="지난 대화">
            <option value="">지난 대화 열기</option>{threads.map(t => <option key={t.id} value={t.id}>{t.title || '제목 없는 대화'}</option>)}</select>}
          <button type="button" className="st-btn st-btn-sm" onClick={newThread}><Plus size={16} />새 대화</button>
        </div>
      </div>
      <div className="st-ideas-log" ref={log}>
        {messages.map(m => <div key={m.id} style={{ display: 'contents' }}>
          <div className={`st-msg st-msg-${m.role}`}>{m.content}{m.meta?.attachments?.length > 0 && <span className="st-msg-files">{m.meta.attachments.map(a => <small key={a.name}><Paperclip size={12} />{a.name}</small>)}</span>}</div>
          {m.role === 'hookai' && m.meta?.cards?.length > 0 && <div className="st-idea-cards">{m.meta.cards.map(c => <IdeaCard key={c.title} card={c} saved={saved.some(s => sameCard(s, c))}
            onSave={() => saveCard(c)} onPlan={async () => { const item = saved.find(s => sameCard(s, c)) || await saveCard(c); if (item) planFrom(item) }} onAsk={send} />)}</div>}
          {m.role === 'hookai' && m === last && m.meta?.chips?.length > 0 && !busy && <div className="st-msg-chips">{m.meta.chips.map(c => <button type="button" key={c} className="st-chip" onClick={() => send(c)}>{c}</button>)}</div>}
        </div>)}
        {pending && <div className="st-msg st-msg-user">{pending}</div>}
        {busy && <><div className="st-chat-typing"><i /><i /><i /></div><ChatWaitLine /></>}
      </div>
      <div className="st-ideas-dock">
        <form className="st-ideas-composer is-dock" onSubmit={e => { e.preventDefault(); send() }}>
          <AttachChips items={files} onRemove={i => setFiles(f => f.filter((_, j) => j !== i))} />
          <textarea value={text} onChange={e => setText(e.target.value)} rows={1} placeholder="답을 적거나, 원하는 걸 말해주세요"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }} aria-label="훅ai에게 보낼 메시지" />
          <div className="st-ideas-composer-foot">
            <AttachButton uploading={uploading} onFiles={upload} />
            <button type="submit" className="st-btn st-btn-primary" disabled={busy || uploading || (!text.trim() && !files.length)} aria-label="보내기"><Send size={18} /></button>
          </div>
        </form>
      </div>
    </section>
    {savedPanel}
  </div>
}
