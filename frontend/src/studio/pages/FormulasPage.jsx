import { useEffect, useState } from 'react'
import { Trash2, Sparkles } from 'lucide-react'
import { useStudio } from '../context'
import { studio, SLOT_LABELS } from '../api'

const KINDS = [['all', '전체'], ['hook', '첫 문장 공식'], ['structure', '전개 공식'], ['filming', '촬영 공식'], ['editing', '편집 공식'], ['caption', '캡션 공식']]

export function FormulaSpec({ kind, spec }) {
  if (!spec) return null
  if (kind === 'hook') return <div className="st-stack" style={{ gap: 6 }}>{spec.formula && <p className="st-formula">{String(spec.formula).split(/(\[[^\]]+\])/).map((p, i) => /^\[/.test(p) ? <mark key={i}>{p}</mark> : p)}</p>}{spec.spoken && <p className="st-muted">예: “{spec.spoken}”</p>}{spec.type && <span className="st-pill">{spec.type}</span>}</div>
  if (kind === 'structure') return <div className="st-stack" style={{ gap: 8 }}>{spec.format && <span className="st-pill">{spec.format}</span>}<div className="st-segments">{(spec.segments || []).map(([name, desc], i) => <div key={i}><strong>{name}</strong><span className="st-muted">{desc}</span></div>)}</div>{spec.totalSeconds && <span className="st-muted st-small">총 {spec.totalSeconds}초</span>}</div>
  if (kind === 'filming') return <div className="st-stack" style={{ gap: 6 }}>{(spec.shots || []).length > 0 && <p><strong>장면:</strong> {spec.shots.join(' → ')}</p>}{spec.camera && <p><strong>카메라:</strong> {spec.camera}</p>}{spec.lighting && <p><strong>조명:</strong> {spec.lighting}</p>}{spec.location && <p><strong>장소:</strong> {spec.location}</p>}</div>
  if (kind === 'editing') return <div className="st-stack" style={{ gap: 6 }}>{spec.subtitleStyle && <p><strong>자막:</strong> {spec.subtitleStyle}</p>}{spec.cuts && <p><strong>컷:</strong> {spec.cuts}</p>}{spec.transitions && <p><strong>전환:</strong> {spec.transitions}</p>}{spec.effects && <p><strong>효과:</strong> {spec.effects}</p>}{spec.sound && <p><strong>사운드:</strong> {spec.sound}</p>}</div>
  if (kind === 'caption') return <div className="st-stack" style={{ gap: 6 }}>{spec.firstLine && <p><strong>첫 줄:</strong> {spec.firstLine}</p>}{spec.ending && <p><strong>마무리:</strong> {spec.ending}</p>}{(spec.hashtags || []).length > 0 && <p className="st-muted">{spec.hashtags.map(t => `#${t}`).join(' ')}</p>}</div>
  return null
}

export default function FormulasPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [kind, setKind] = useState('all')
  const [error, setError] = useState('')
  useEffect(() => { studio.formulas().then(d => setItems(d.formulas)).catch(e => setError(e.message)) }, [])
  const remove = async f => {
    if (!window.confirm(`'${f.title}' 공식을 지울까요?`)) return
    setItems(list => list.filter(i => i.id !== f.id))
    try { await studio.removeFormula(f.id) } catch (e) { toast({ kind: 'failed', title: '삭제 실패', body: e.message }) }
  }
  if (error) return <div className="st-error">{error}</div>
  if (!items) return <p className="st-muted">불러오는 중…</p>
  const shown = kind === 'all' ? items : items.filter(f => f.kind === kind)
  return <div className="st-stack">
    <div className="st-page-head"><p>기획안의 각 단계에서 '이 공식 저장'을 누르면 여기 모여요. 새 기획안을 만들 때 재료로 골라 쓸 수 있어요.</p></div>
    <div className="st-chips">{KINDS.map(([id, label]) => <button type="button" key={id} className="st-chip" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}{id !== 'all' && <span className="st-muted">· {items.filter(f => f.kind === id).length}</span>}</button>)}</div>
    {shown.length === 0 && <div className="st-empty"><strong>저장한 공식이 없어요</strong><span>기획안을 완성하면 첫 문장·전개·촬영·편집·캡션 공식을 저장할 수 있어요. 공식 사전의 유형도 담아둘 수 있어요.</span><div className="st-row"><button type="button" className="st-btn st-btn-primary" onClick={() => go('new')}><Sparkles size={18} />기획안 만들기</button><button type="button" className="st-btn" onClick={() => go('library')}>공식 사전 보기</button></div></div>}
    <div className="st-lib">{shown.map(f => <div className="st-lib-card" key={f.id}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill st-pill-gray">{SLOT_LABELS[f.kind]}</span><button type="button" className="st-icon-btn" style={{ width: 36, height: 36 }} aria-label="삭제" onClick={() => remove(f)}><Trash2 size={16} /></button></div>
      <strong>{f.title}</strong>
      <FormulaSpec kind={f.kind} spec={f.spec} />
      {f.source?.topic && <span className="st-muted st-small">출처: {f.source.topic}</span>}
    </div>)}</div>
  </div>
}
