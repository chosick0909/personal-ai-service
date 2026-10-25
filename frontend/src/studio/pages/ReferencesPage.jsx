import { useEffect, useState } from 'react'
import { Trash2, Sparkles, Check, ListOrdered, Clapperboard, PenLine, Quote, Plus, Link2, Upload, FileText, X, LoaderCircle } from 'lucide-react'
import { apiFetch, parseApiResponse, createApiError } from '../../lib/api'
import { useStudio } from '../context'
import { studio } from '../api'
import { ReelCard, PlayerModal } from './ReelsPage'

const FILTERS = [['all', '전체'], ['hook', '첫 문장이 좋았던'], ['structure', '흐름이 좋았던'], ['filming', '촬영/편집이 좋았던'], ['caption', '캡션이 좋았던']]
const LIKES = [['hook', '첫 문장이 좋아요', Quote], ['structure', '흐름이 좋아요', ListOrdered], ['filming', '촬영/편집이 좋아요', Clapperboard], ['caption', '캡션이 좋아요', PenLine]]

// 추가하기: an Instagram link, a video file or a pasted script becomes a reference and is analyzed right away.
function AddReferenceModal({ onClose, onAdded }) {
  const [tab, setTab] = useState('link')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      let result
      if (tab === 'link') result = await studio.addLink(url.trim())
      else if (tab === 'text') result = await studio.addText(title.trim(), body.trim())
      else {
        if (!file) throw new Error('영상 파일을 골라주세요.')
        const form = new FormData(); form.append('video', file); if (title.trim()) form.append('title', title.trim())
        const response = await apiFetch('/api/creator-tools/studio/references/video', { method: 'POST', body: form, timeoutMs: 300000 })
        const payload = await parseApiResponse(response)
        if (!response.ok) throw createApiError(response, payload, '영상을 올리지 못했어요.')
        result = payload
      }
      onAdded({ shortcode: result.shortcode, username: result.title || (tab === 'link' ? url.trim().split('/').filter(Boolean).pop() : '내 레퍼런스'), analysisStatus: result.status })
    } catch (err) { setError(err.message); setBusy(false) }
  }
  const tabs = [['link', '인스타그램 링크', Link2], ['video', '영상 업로드', Upload], ['text', '대본 텍스트', FileText]]
  return <div className="st-modal" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className="st-modal-box" onSubmit={submit}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><h2>레퍼런스 추가하기</h2><button type="button" className="st-icon-btn" aria-label="닫기" onClick={onClose} disabled={busy}><X size={20} /></button></div>
      <div className="st-chips">{tabs.map(([id, label, icon]) => { const Icon = icon; return <button type="button" key={id} className="st-chip" aria-pressed={tab === id} onClick={() => setTab(id)}><Icon size={16} />{label}</button> })}</div>
      {tab === 'link' && <div className="st-field"><label>릴스 링크 <small>공개 릴스만 돼요. 조회수 50만 이상·3개월 이내면 성공 릴스에도 올라가요.</small></label><input className="st-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url" autoFocus /></div>}
      {tab === 'video' && <><div className="st-field"><label>영상 파일 <small>150MB·5분 이하. 나만 볼 수 있어요.</small></label><input type="file" accept="video/*" className="st-input" onChange={e => setFile(e.target.files?.[0] || null)} /></div><div className="st-field"><label>제목 (선택)</label><input className="st-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 지난달 올린 선크림 리뷰" /></div></>}
      {tab === 'text' && <><div className="st-field"><label>제목 (선택)</label><input className="st-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="예) 경쟁사 릴스 대본" /></div><div className="st-field"><label>대본 <small>말한 순서대로 붙여넣어 주세요. 나만 볼 수 있어요.</small></label><textarea className="st-textarea" value={body} onChange={e => setBody(e.target.value)} placeholder="첫 문장부터 마지막 문장까지" /></div></>}
      {error && <div className="st-error" role="alert">{error}</div>}
      <button type="submit" className="st-btn st-btn-primary st-btn-big" disabled={busy || (tab === 'link' ? !url.trim() : tab === 'text' ? body.trim().length < 20 : !file)}>{busy ? <><LoaderCircle size={20} className="st-spin" />{tab === 'video' ? '올리는 중…' : '가져오는 중…'}</> : <><Sparkles size={20} />추가하고 분석하기</>}</button>
    </form>
  </div>
}

export default function ReferencesPage() {
  const { go, toast, analyze } = useStudio()
  const [items, setItems] = useState(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => { studio.references().then(d => setItems(d.references)).catch(e => setError(e.message)) }, [])
  const toggleTag = async (ref, tag) => {
    const tags = ref.tags.includes(tag) ? ref.tags.filter(t => t !== tag) : [...ref.tags, tag]
    setItems(list => list.map(r => r.id === ref.id ? { ...r, tags } : r))
    try { await studio.tagReference(ref.id, tags) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) }
  }
  const remove = async ref => {
    if (!window.confirm(`@${ref.username} 릴스를 내 레퍼런스에서 뺄까요? 분석 결과는 남아 있어 언제든 다시 분석할 수 있어요.`)) return
    setItems(list => list.filter(r => r.id !== ref.id))
    try { await studio.removeReference(ref.id) } catch (e) { toast({ kind: 'failed', title: '삭제 실패', body: e.message }) }
  }
  if (error) return <div className="st-error">{error}</div>
  if (!items) return <p className="st-muted">불러오는 중…</p>
  const shown = filter === 'all' ? items : items.filter(r => r.tags.includes(filter))
  return <div className="st-stack">
    <div className="st-page-head"><p>분석하기를 누른 릴스가 자동으로 모여요. 어떤 점이 좋았는지 표시해 두면 기획안 만들 때 바로 찾아 쓸 수 있어요.</p><button type="button" className="st-btn st-btn-primary st-btn-big" onClick={() => setAdding(true)}><Plus size={22} />추가하기</button></div>
    <div className="st-chips" role="group" aria-label="참고 분류">{FILTERS.map(([id, label]) => <button type="button" key={id} className="st-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{id !== 'all' && <span className="st-muted">· {items.filter(r => r.tags.includes(id)).length}</span>}</button>)}</div>
    {shown.length === 0 && <div className="st-empty"><strong>{filter === 'all' ? '아직 레퍼런스가 없어요' : '이 분류로 표시한 릴스가 없어요'}</strong><span>성공 릴스에서 '분석하기'를 누르거나, 위 '추가하기'로 링크·영상·대본을 직접 넣어보세요.</span><div className="st-row"><button type="button" className="st-btn st-btn-primary" onClick={() => setAdding(true)}><Plus size={18} />추가하기</button><button type="button" className="st-btn" onClick={() => go('reels')}>성공 릴스 보러 가기</button></div></div>}
    <div className="st-reels">{shown.map(ref => { const reel = { shortcode: ref.id, username: ref.username, title: ref.title, views: ref.views, postedAt: ref.postedAt, caption: ref.caption, permalink: ref.permalink, thumbnailUrl: ref.thumbnailUrl, analysisStatus: ref.analysisStatus, analysisRequests: ref.analysisRequests, source: ref.source }
      return <ReelCard key={ref.id} reel={reel} badge={ref.format ? <span className="st-reel-badge">{ref.format}</span> : null} onPlay={() => setOpen(reel)} onAnalyze={() => go('reference', { ref: ref.id })} onOpenAnalysis={() => go('reference', { ref: ref.id })}
        footer={<button type="button" className="st-reel-ig" aria-label="내 레퍼런스에서 빼기" data-tip="내 레퍼런스에서 빼기" onClick={() => remove(ref)}><Trash2 size={17} /></button>}>
        <div className="st-ref-like"><span className="st-ref-like-title">이 릴스에서 배울 점을 표시해 두세요</span>
          <div className="st-tags" role="group" aria-label="참고할 점">{LIKES.map(([tag, label, icon]) => { const Icon = icon; const on = ref.tags.includes(tag); return <button type="button" key={tag} className="st-tag" aria-pressed={on} onClick={() => toggleTag(ref, tag)}>{on ? <Check size={14} /> : <Icon size={14} />}{label}</button> })}</div></div>
        <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => go('new', { ref: ref.id })}><Sparkles size={16} />이 레퍼런스로 기획안 만들기</button>
      </ReelCard> })}</div>
    {open && <PlayerModal reel={open} onClose={() => setOpen(null)} onAnalyze={() => go('reference', { ref: open.shortcode })} onOpenAnalysis={() => go('reference', { ref: open.shortcode })} />}
    {adding && <AddReferenceModal onClose={() => setAdding(false)} onAdded={added => { setAdding(false); toast({ kind: 'ready', title: '레퍼런스를 추가했어요', body: '분석이 끝나면 바로 열어드릴게요.' }); analyze(added) }} />}
  </div>
}
