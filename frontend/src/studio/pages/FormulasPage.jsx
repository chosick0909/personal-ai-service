import { useEffect, useState } from 'react'
import { Trash2, Sparkles, ChevronRight, X } from 'lucide-react'
import { useStudio } from '../context'
import { studio, SLOT_LABELS, when } from '../api'

const KINDS = [['all', '전체'], ['hook', '첫 문장 공식'], ['structure', '전개 공식'], ['filming', '촬영/편집 공식'], ['caption', '캡션 공식']]

export function FormulaSpec({ kind, spec }) {
  if (!spec) return null
  if (kind === 'hook') return <div className="st-stack" style={{ gap: 6 }}>{spec.formula && <p className="st-formula">{String(spec.formula).split(/(\[[^\]]+\])/).map((p, i) => /^\[/.test(p) ? <mark key={i}>{p}</mark> : p)}</p>}{spec.spoken && <p className="st-muted">예: “{spec.spoken}”</p>}{spec.type && <span className="st-pill">{spec.type}</span>}</div>
  if (kind === 'structure') return <div className="st-stack" style={{ gap: 8 }}>{spec.format && <span className="st-pill">{spec.format}</span>}<div className="st-segments">{(spec.segments || []).map(([name, desc], i) => <div key={i}><strong>{name}</strong><span className="st-muted">{desc}</span></div>)}</div>{spec.totalSeconds && <span className="st-muted st-small">총 {spec.totalSeconds}초</span>}</div>
  if (kind === 'filming') return <div className="st-stack" style={{ gap: 6 }}>{(spec.shots || []).length > 0 && <p><strong>장면:</strong> {spec.shots.join(' → ')}</p>}{spec.camera && <p><strong>카메라:</strong> {spec.camera}</p>}{spec.lighting && <p><strong>조명:</strong> {spec.lighting}</p>}{spec.location && <p><strong>장소:</strong> {spec.location}</p>}{spec.subtitleStyle && <p><strong>자막:</strong> {spec.subtitleStyle}</p>}{spec.cuts && <p><strong>컷:</strong> {spec.cuts}</p>}{spec.effects && <p><strong>효과:</strong> {spec.effects}</p>}{spec.sound && <p><strong>사운드:</strong> {spec.sound}</p>}{spec.editing && <p><strong>편집:</strong> {spec.editing}</p>}</div>
  if (kind === 'caption') return <div className="st-stack" style={{ gap: 6 }}>{spec.firstLine && <p><strong>첫 줄:</strong> {spec.firstLine}</p>}{spec.ending && <p><strong>마무리:</strong> {spec.ending}</p>}{(spec.hashtags || []).length > 0 && <p className="st-muted">{spec.hashtags.map(t => `#${t}`).join(' ')}</p>}</div>
  return null
}

// One line that says what the formula is, for the list; the card shows the full spec.
const strip = title => String(title || '').replace(/^(첫 문장|전개|촬영\/편집|캡션):\s*/, '')
function summary(f) {
  const s = f.spec || {}
  if (f.kind === 'hook') return s.formula || s.spoken || ''
  if (f.kind === 'structure') return [s.format, ...(s.segments || []).map(seg => seg[0])].filter(Boolean).join(' → ')
  if (f.kind === 'filming') return [(s.shots || []).join(' → '), s.subtitleStyle].filter(Boolean).join(' · ')
  if (f.kind === 'caption') return s.firstLine || ''
  return ''
}

function FormulaDetail({ formula: f, onClose, onRemove, onUse }) {
  return <div className="st-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="st-modal-box" role="dialog" aria-label={`${SLOT_LABELS[f.kind]} 공식`}>
      <div className="st-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="st-stack" style={{ gap: 8 }}><span className="st-pill">{SLOT_LABELS[f.kind]} 공식</span><h2>{strip(f.title)}</h2></div>
        <button type="button" className="st-icon-btn" aria-label="닫기" onClick={onClose}><X size={20} /></button>
      </div>
      <section className="st-card st-stack" style={{ background: 'var(--st-bg)' }}><h3>공식</h3><FormulaSpec kind={f.kind} spec={f.spec} /></section>
      {f.example && <section className="st-card st-stack" style={{ background: 'var(--st-bg)' }}><h3>예시</h3><p style={{ whiteSpace: 'pre-wrap' }}>{f.example}</p></section>}
      <div className="st-muted st-small">{f.source?.topic ? `출처: 기획안 '${f.source.topic}'` : f.source?.username ? `출처: @${f.source.username} 영상 분석` : f.source?.libraryId ? '출처: 공식 사전' : ''}{f.createdAt ? ` · ${when(f.createdAt)} 저장` : ''}</div>
      <div className="st-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button type="button" className="st-btn st-btn-danger" onClick={onRemove}><Trash2 size={16} />삭제</button>
        <button type="button" className="st-btn st-btn-primary st-btn-big" onClick={onUse}><Sparkles size={18} />이 공식으로 기획안 만들기</button>
      </div>
    </div>
  </div>
}

export default function FormulasPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [kind, setKind] = useState('all')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
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
    {shown.length === 0 && <div className="st-empty"><strong>저장한 공식이 없어요</strong><span>기획안을 완성하면 첫 문장·전개·촬영/편집·캡션 공식을 저장할 수 있어요. 공식 사전의 유형도 담아둘 수 있어요.</span><div className="st-row"><button type="button" className="st-btn st-btn-primary" onClick={() => go('new')}><Sparkles size={18} />기획안 만들기</button><button type="button" className="st-btn" onClick={() => go('library')}>공식 사전 보기</button></div></div>}
    <div className="st-formula-list">{shown.map(f => <button type="button" className="st-formula-row" key={f.id} onClick={() => setOpen(f)}>
      <span className="st-pill st-pill-gray">{SLOT_LABELS[f.kind]}</span>
      <span className="st-formula-row-text"><strong>{strip(f.title)}</strong><span className="st-muted">{summary(f)}</span></span>
      <span className="st-muted st-small st-formula-row-when">{f.source?.topic ? `기획안 '${f.source.topic}'` : f.source?.username ? `@${f.source.username}` : f.source?.libraryId ? '공식 사전' : ''}{f.createdAt ? ` · ${when(f.createdAt)}` : ''}</span>
      <ChevronRight size={20} className="st-muted" />
    </button>)}</div>
    {open && <FormulaDetail formula={open} onClose={() => setOpen(null)} onRemove={() => { setOpen(null); remove(open) }} onUse={() => go('new', { formula: open.id, kind: open.kind })} />}
  </div>
}
