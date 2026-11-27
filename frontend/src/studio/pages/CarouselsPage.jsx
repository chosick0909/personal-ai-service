import { useEffect, useState } from 'react'
import { ArrowRight, Trash2, Sparkles, ExternalLink, MessageSquareText } from 'lucide-react'
import { useStudio } from '../context'
import { studio, when, CAROUSEL_STAGES } from '../api'

const SLOTS = [['structure', '구성', '장의 순서와 넘기게 하는 방식을 따라가요', () => true], ['design', '디자인', '틀의 종류와 색 조합만 참고해요', r => r.media === 'carousel'], ['caption', '캡션', '첫 줄·본문·마무리 방식을 따라가요', () => true]]
const refName = r => `@${r.username} · ${r.media === 'carousel' ? '캐러셀' : '릴스'} · ${String(r.caption || r.title || '').replace(/\s+/g, ' ').slice(0, 26)}`

// 캐러셀 만들기 (내부 전용): start a carousel from what the student wants to say, and pick up the ones in progress.
export default function CarouselsPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [refs, setRefs] = useState([])
  const [error, setError] = useState('')
  const [brief, setBrief] = useState('')
  const [sources, setSources] = useState({})
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    studio.sessions().then(d => setItems(d.sessions.filter(s => s.format === 'carousel'))).catch(e => setError(e.message))
    studio.references().then(d => setRefs((d.references || []).filter(r => r.analysisStatus === 'ready' && !String(r.source || '').startsWith('upload-text')))).catch(() => {})
  }, [])
  // A carousel is a plan like a reel's. talk: start at the topic conversation; otherwise go straight to the cover.
  const start = async talk => {
    setStarting(talk ? 'talk' : 'cover')
    try {
      const r = await studio.createSession({ format: 'carousel', brief, sources: Object.fromEntries(Object.entries(sources).filter(([, id]) => id).map(([slot, id]) => [slot, { id }])) })
      // Started from what was typed: the topic is read from it at once and the cover is written, as [이 내용으로 바로 시작] does.
      if (!talk) await studio.setTopic(r.session.id, { title: brief.split(/[.!?\n]/).map(t => t.trim()).find(Boolean)?.slice(0, 60) || '', category: '기타', facts: [], fromBrief: true })
      go('carousel', { id: r.session.id })
    }
    catch (e) { toast({ kind: 'failed', title: '시작하지 못했어요', body: e.message }) } finally { setStarting(false) }
  }
  const remove = async c => {
    if (!window.confirm('이 캐러셀을 지울까요? 되돌릴 수 없어요.')) return
    setItems(list => list.filter(i => i.id !== c.id))
    try { await studio.removeSession(c.id) } catch (e) { toast({ kind: 'failed', title: '삭제 실패', body: e.message }) }
  }
  if (error) return <div className="st-error">{error}</div>
  const label = stage => CAROUSEL_STAGES.find(([id]) => id === stage)?.[1] || stage
  return <div className="st-stack" style={{ maxWidth: 920 }}>
    <div className="st-note st-small">내부에서 먼저 써 보는 화면이에요. 수강생에게는 아직 보이지 않아요.</div>
    <section className="st-card st-stack">
      <div className="st-field"><label htmlFor="cr-brief">어떤 캐러셀을 만들까요?<small>다룰 내용, 내 경험, 꼭 넣을 숫자나 사실을 편하게 적어주세요. 아직 못 정했으면 비워 두고 훅ai와 주제부터 정해도 돼요.</small></label>
        <textarea id="cr-brief" className="st-textarea" value={brief} onChange={e => setBrief(e.target.value)} placeholder="예) 퇴근 후 2시간으로 구움과자 주문 제작을 시작한 과정. 집 오븐으로 시작했고…" /></div>
      {refs.length > 0 && <details><summary className="st-muted" style={{ cursor: 'pointer', fontWeight: 700 }}>레퍼런스 고르기 (선택)</summary>
        <div className="st-grid-3" style={{ marginTop: 12 }}>{SLOTS.map(([slot, name, hint, fits]) => <div className="st-field" key={slot}><label htmlFor={`cr-${slot}`}>{name}<small>{hint}</small></label>
          <select id={`cr-${slot}`} className="st-select" value={sources[slot] || ''} onChange={e => setSources(s => ({ ...s, [slot]: e.target.value }))}><option value="">고르지 않음</option>{refs.filter(fits).map(r => <option key={r.id} value={r.id}>{refName(r)}</option>)}</select></div>)}</div></details>}
      <div className="st-row">
        <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={Boolean(starting)} onClick={() => start(true)}><MessageSquareText size={20} />{starting === 'talk' ? '여는 중…' : '훅ai와 주제부터 정하기'}</button>
        <button type="button" className="st-btn st-btn-big" disabled={Boolean(starting) || brief.trim().length < 4} onClick={() => start(false)}><Sparkles size={20} />{starting === 'cover' ? '여는 중…' : '이 내용으로 표지 제목부터'}</button>
      </div>
    </section>
    {items && items.length > 0 && <h3>만들던 캐러셀</h3>}
    {!items ? <p className="st-muted">불러오는 중…</p> : <div className="st-stack" style={{ gap: 10 }}>{items.map(c => <div className="st-card st-row" key={c.id} style={{ padding: '16px 20px', gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8, marginBottom: 4 }}><span className={`st-pill ${c.stage === 'done' ? 'st-pill-green' : ''}`}>{c.stage === 'done' ? '완성' : `${label(c.stage)} 단계`}</span>{c.jobStatus === 'running' && <span className="st-pill">훅ai 작업 중</span>}</div>
        <strong style={{ fontSize: 18, display: 'block' }}>{c.title || '새 캐러셀'}</strong>
        <span className="st-muted st-small">{when(c.updatedAt)}</span>
      </div>
      <button type="button" className="st-icon-btn" aria-label="삭제" title="삭제" onClick={() => remove(c)}><Trash2 size={18} /></button>
      <a className="st-icon-btn" href={`/studio?p=carousel&id=${c.id}`} target="_blank" rel="noreferrer" aria-label="새 창으로 열기" title="새 창으로 열기"><ExternalLink size={18} /></a>
      <button type="button" className="st-btn st-btn-primary" onClick={() => go('carousel', { id: c.id })}>{c.stage === 'done' ? '보기' : '이어하기'}<ArrowRight size={18} /></button>
    </div>)}</div>}
  </div>
}
