import { useEffect, useState } from 'react'
import { ArrowRight, Trash2, Sparkles, Printer } from 'lucide-react'
import { useStudio } from '../context'
import { studio, when, STAGES } from '../api'

const MODE = { single: '레퍼런스 하나로', mix: '레퍼런스 조합', topic: '주제만으로' }

export default function PlansPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { studio.sessions().then(d => setItems(d.sessions)).catch(e => setError(e.message)) }, [])
  const remove = async s => {
    if (!window.confirm('이 기획안을 지울까요? 되돌릴 수 없어요.')) return
    setItems(list => list.filter(i => i.id !== s.id))
    try { await studio.removeSession(s.id) } catch (e) { toast({ kind: 'failed', title: '삭제 실패', body: e.message }) }
  }
  if (error) return <div className="st-error">{error}</div>
  if (!items) return <p className="st-muted">불러오는 중…</p>
  const label = stage => STAGES.find(([id]) => id === stage)?.[1] || stage
  return <div className="st-stack">
    <div className="st-page-head"><p>중간에 나가도 그 자리에서 이어져요. 완성된 기획안은 PDF로 받을 수 있어요.</p><button type="button" className="st-btn st-btn-primary" onClick={() => go('new')}><Sparkles size={18} />새 기획안</button></div>
    {items.length === 0 && <div className="st-empty"><strong>아직 만든 기획안이 없어요</strong><span>오른쪽 아래 '내 기획안 만들기'를 눌러 시작해 보세요.</span></div>}
    <div className="st-stack" style={{ gap: 10 }}>{items.map(s => <div className="st-card st-row" key={s.id} style={{ padding: '16px 20px', gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="st-row" style={{ gap: 8, marginBottom: 4 }}><span className={`st-pill ${s.stage === 'done' ? 'st-pill-green' : ''}`}>{s.stage === 'done' ? '완성' : `${label(s.stage)} 단계`}</span><span className="st-pill st-pill-gray">{MODE[s.mode]}</span>{s.jobStatus === 'running' && <span className="st-pill">훅ai 작업 중</span>}</div>
        <strong style={{ fontSize: 18, display: 'block' }}>{s.title || '주제 정하는 중'}</strong>
        <span className="st-muted st-small">{when(s.updatedAt)}</span>
      </div>
      {s.stage === 'done' && <button type="button" className="st-icon-btn" aria-label="인쇄·PDF" title="인쇄·PDF" onClick={() => go('print', { session: s.id })}><Printer size={18} /></button>}
      <button type="button" className="st-icon-btn" aria-label="삭제" title="삭제" onClick={() => remove(s)}><Trash2 size={18} /></button>
      <button type="button" className="st-btn st-btn-primary" onClick={() => go('plan', { session: s.id })}>{s.stage === 'done' ? '보기' : '이어하기'}<ArrowRight size={18} /></button>
    </div>)}</div>
  </div>
}
