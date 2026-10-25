import { useEffect, useState } from 'react'
import { Sparkles, Layers, PenLine, Check, X, BookOpen, Wand2, FolderHeart } from 'lucide-react'
import { useStudio } from '../context'
import { studio, SLOT_LABELS } from '../api'

const SLOTS = ['hook', 'structure', 'filming', 'caption']
const SLOT_HELP = { hook: '첫 3초 말 훅과 화면 훅을 가져와요', structure: '이야기가 흘러가는 순서와 리듬을 가져와요', filming: '구도·조명 같은 촬영 방식과 자막·컷·효과 같은 편집 방식을 함께 가져와요', caption: '캡션의 첫 줄과 마무리 방식을 가져와요 (선택)' }

// Picks one source for a slot from 내 레퍼런스 / 내 공식 / 공식 사전.
function SlotPicker({ slot, refs, formulas, library, onPick, onClose }) {
  const [tab, setTab] = useState('refs')
  const kind = slot === 'hook' ? 'hook' : slot === 'structure' ? 'structure' : slot
  const tagged = refs.filter(r => r.tags.includes(slot)), others = refs.filter(r => !r.tags.includes(slot))
  const libItems = slot === 'hook' ? library?.hooks || [] : slot === 'structure' ? library?.structures || [] : []
  return <div className="st-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="st-modal-box">
      <div className="st-row" style={{ justifyContent: 'space-between' }}><h2>{SLOT_LABELS[slot]} 재료 고르기</h2><button type="button" className="st-icon-btn" aria-label="닫기" onClick={onClose}><X size={20} /></button></div>
      <div className="st-chips"><button type="button" className="st-chip" aria-pressed={tab === 'refs'} onClick={() => setTab('refs')}><FolderHeart size={16} />내 레퍼런스 · {refs.length}</button><button type="button" className="st-chip" aria-pressed={tab === 'formulas'} onClick={() => setTab('formulas')}><Wand2 size={16} />내 공식 · {formulas.filter(f => f.kind === kind).length}</button>{libItems.length > 0 && <button type="button" className="st-chip" aria-pressed={tab === 'library'} onClick={() => setTab('library')}><BookOpen size={16} />공식 사전</button>}</div>
      {tab === 'refs' && <div className="st-stack" style={{ gap: 10 }}>
        {refs.length === 0 && <div className="st-empty"><strong>아직 분석한 릴스가 없어요</strong><span>성공 릴스에서 '분석하기'를 눌러 모아주세요.</span></div>}
        {[...tagged, ...others].map(r => <button type="button" key={r.id} className="st-option" onClick={() => onPick({ kind: 'reel', id: r.id, label: r.title || `@${r.username}`, thumbnailUrl: r.thumbnailUrl })} style={{ gridTemplateColumns: '56px 1fr', display: 'grid', alignItems: 'center', gap: 14 }}>
          {r.thumbnailUrl ? <img src={r.thumbnailUrl} alt="" style={{ width: 56, height: 84, objectFit: 'cover', borderRadius: 8, gridRow: 'span 2' }} /> : <span style={{ gridRow: 'span 2' }} />}
          <strong>{r.title || `@${r.username}`}{r.tags.includes(slot) && <span className="st-pill" style={{ marginLeft: 8 }}>{SLOT_LABELS[slot]} 참고</span>}</strong>
          <span className="st-why">{slot === 'hook' ? r.hookType : slot === 'structure' ? r.format : ''} {r.summary ? `· ${r.summary}` : ''}</span>
        </button>)}
      </div>}
      {tab === 'formulas' && <div className="st-stack" style={{ gap: 10 }}>
        {formulas.filter(f => f.kind === kind).length === 0 && <div className="st-empty"><strong>저장한 {SLOT_LABELS[slot]} 공식이 없어요</strong><span>기획안을 완성하면 각 단계에서 '이 공식 저장'을 누를 수 있어요.</span></div>}
        {formulas.filter(f => f.kind === kind).map(f => <button type="button" key={f.id} className="st-option" onClick={() => onPick({ kind: 'formula', id: f.id, label: f.title })}><strong>{f.title}</strong><span className="st-why">{f.example?.slice(0, 80)}</span></button>)}
      </div>}
      {tab === 'library' && <div className="st-stack" style={{ gap: 10 }}>{libItems.map(item => <button type="button" key={item.id} className="st-option" onClick={() => onPick({ kind: 'library', id: item.id, label: item.title })}><strong>{item.title}</strong><span className="st-why">{item.formula || item.summary}</span></button>)}</div>}
    </div>
  </div>
}

function SourceChip({ source }) {
  return <span className="st-source-chip">{source.thumbnailUrl ? <img src={source.thumbnailUrl} alt="" /> : <span className="st-source-chip-blank" />}<span>{source.label || source.id}</span></span>
}

export default function PlanStart({ preset = {} }) {
  const { go, toast } = useStudio()
  const [mode, setMode] = useState(preset.ref ? 'single' : null)
  const [sources, setSources] = useState(() => preset.ref ? { hook: { kind: 'reel', id: preset.ref, label: '' } } : {})
  const [picking, setPicking] = useState(null)
  const [data, setData] = useState({ refs: [], formulas: [], library: null })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([studio.references(), studio.formulas(), studio.library().catch(() => null)]).then(([r, f, l]) => {
      setData({ refs: r.references, formulas: f.formulas, library: l })
      if (preset.ref) { const found = r.references.find(x => x.id === preset.ref); if (found) setSources({ hook: { kind: 'reel', id: found.id, label: found.title || `@${found.username}`, thumbnailUrl: found.thumbnailUrl } }) }
    }).catch(() => {})
  }, [preset.ref])
  const start = async () => {
    setBusy(true)
    try {
      const body = { mode: mode || 'topic', sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { kind: v.kind, id: v.id }])) }
      if (mode === 'single') { const one = sources.hook; body.sources = { hook: { kind: one.kind, id: one.id } } }
      const result = await studio.createSession(body)
      go('plan', { session: result.session.id }, { replace: true })
    } catch (e) { toast({ kind: 'failed', title: '시작하지 못했어요', body: e.message }); setBusy(false) }
  }
  const modes = [
    ['single', '레퍼런스 하나로', '터진 릴스 하나의 공식을 내 주제에 적용해요', Sparkles],
    ['mix', '레퍼런스 조합', '첫 문장·전개·촬영·캡션을 각각 다른 곳에서 가져와 나만의 포맷을 만들어요', Layers],
    ['topic', '주제만으로', '레퍼런스 없이 훅ai와 대화하며 주제부터 잡아요', PenLine],
  ]
  const canStart = mode === 'topic' || (mode === 'single' && sources.hook) || (mode === 'mix' && Object.keys(sources).length > 0)
  return <div className="st-stack" style={{ maxWidth: 860 }}>
    <div className="st-note">훅ai가 주제 → 썸네일 → 첫 문장 → 대본 → 촬영·편집 → 캡션 순서로 한 단계씩 같이 만들어요. 중간에 나가도 이어져요.</div>
    <div className="st-options">{modes.map(([id, title, desc, icon]) => { const Icon = icon; return <button type="button" key={id} className="st-option" aria-pressed={mode === id} onClick={() => { setMode(id); if (id === 'topic') setSources({}) }}>
      <div className="st-option-top"><Icon size={22} style={{ color: 'var(--st-accent)' }} /><strong>{title}</strong><span className="st-option-check"><Check size={16} /></span></div><span className="st-why">{desc}</span></button> })}</div>
    {mode === 'single' && <section className="st-card st-stack">
      <h3>어떤 릴스로 만들까요?</h3>
      {sources.hook ? <div className="st-row" style={{ justifyContent: 'space-between' }}><SourceChip source={sources.hook} /><button type="button" className="st-btn st-btn-sm" onClick={() => setPicking('hook')}>바꾸기</button></div>
        : <button type="button" className="st-btn st-btn-soft st-btn-big" onClick={() => setPicking('hook')}>내 레퍼런스에서 고르기</button>}
    </section>}
    {mode === 'mix' && <section className="st-card st-stack">
      <div><h3>어디서 무엇을 가져올까요?</h3><p className="st-muted">칸마다 하나씩. 같은 릴스를 여러 칸에 넣어도 돼요. 비워 두면 훅ai가 공식 사전에서 골라요.</p></div>
      {SLOTS.map(slot => <div key={slot} className="st-row" style={{ justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--st-line)' }}>
        <div><strong style={{ fontSize: 17 }}>{SLOT_LABELS[slot]}</strong><p className="st-muted st-small">{SLOT_HELP[slot]}</p></div>
        <div className="st-row">{sources[slot] && <SourceChip source={sources[slot]} />}
          <button type="button" className="st-btn st-btn-sm" onClick={() => setPicking(slot)}>{sources[slot] ? '바꾸기' : '고르기'}</button>
          {sources[slot] && <button type="button" className="st-icon-btn" style={{ width: 40, height: 40 }} aria-label="비우기" onClick={() => setSources(s => { const n = { ...s }; delete n[slot]; return n })}><X size={16} /></button>}</div>
      </div>)}
    </section>}
    {mode && <button type="button" className="st-btn st-btn-primary st-btn-big st-btn-block" disabled={!canStart || busy} onClick={start}>{busy ? '훅ai 부르는 중…' : '훅ai와 시작하기'}</button>}
    {picking && <SlotPicker slot={picking} refs={data.refs} formulas={data.formulas} library={data.library} onClose={() => setPicking(null)} onPick={src => { setSources(s => ({ ...s, [picking]: src })); setPicking(null) }} />}
  </div>
}
