import { useEffect, useState } from 'react'
import { ArrowLeft, Save, Play } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount } from '../api'

export default function LibraryPage() {
  const { go, toast } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('structures')
  const [open, setOpen] = useState(null)
  useEffect(() => { studio.library().then(setData).catch(e => setError(e.message)) }, [])
  const save = async (kind, item) => { try { await studio.saveFormula({ kind, libraryId: item.id }); toast({ kind: 'ready', title: '내 공식에 담았어요', body: item.title, action: { label: '내 공식 보기', onClick: () => go('formulas') } }) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) } }
  if (error) return <div className="st-error">{error}</div>
  if (!data) return <p className="st-muted">불러오는 중…</p>
  const items = tab === 'hooks' ? data.hooks : data.structures
  if (open) {
    const kind = tab === 'hooks' ? 'hook' : 'structure'
    return <div className="st-stack" style={{ maxWidth: 860 }}>
      <button type="button" className="st-btn st-btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(null)}><ArrowLeft size={20} />공식 사전</button>
      <section className="st-card st-stack">
        <div className="st-card-head"><div><span className="st-pill">{tab === 'hooks' ? '첫 문장 공식' : '전개 공식'}</span><h2 style={{ marginTop: 8, fontSize: 24 }}>{open.title}</h2></div><button type="button" className="st-btn st-btn-soft" onClick={() => save(kind, open)}><Save size={18} />내 공식에 담기</button></div>
        {open.summary && <p style={{ fontSize: 17 }}>{open.summary}</p>}
        {open.formula && <div className="st-kv"><span>공식</span><p className="st-formula">{open.formula.split(/(\[[^\]]+\])/).map((p, i) => /^\[/.test(p) ? <mark key={i}>{p}</mark> : p)}</p></div>}
        <div className="st-kv"><span>언제 쓰나</span><div>{open.when}</div></div>
        {open.example && <div className="st-kv"><span>예시</span><div>“{open.example}”</div></div>}
        {open.segments && <div className="st-kv"><span>흐름</span><div className="st-segments">{open.segments.map(([name, desc], i) => <div key={i}><strong>{name}</strong><span className="st-muted">{desc}</span></div>)}</div></div>}
      </section>
      <section className="st-card st-stack"><div className="st-card-head"><h3>이 공식으로 터진 릴스 <span className="st-muted st-small">· {open.count}개</span></h3></div>
        {open.examples.length === 0 ? <p className="st-muted">아직 이 공식으로 분석된 릴스가 없어요. 매일 늘어나요.</p>
          : <div className="st-examples">{open.examples.map(e => <button type="button" key={e.id} className="st-example" onClick={() => go('reference', { ref: e.id })}>{e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" loading="lazy" /> : <div style={{ aspectRatio: '9/16', borderRadius: 10, background: '#1b1825' }} />}<strong className="st-small">@{e.username}</strong><span><Play size={11} /> {compactCount(e.views)}</span>{e.hook && <span>“{e.hook}”</span>}</button>)}</div>}
      </section>
    </div>
  }
  return <div className="st-stack">
    <div className="st-page-head"><p>터진 릴스가 공통으로 쓰는 첫 문장·전개 공식이에요. 훅ai가 매일 성공 릴스를 공부하면서 공식마다 그 공식을 쓴 릴스를 채우고, 여러 릴스에서 되풀이되는 새 공식을 찾으면 여기에 더해요.</p></div>
    <div className="st-chips"><button type="button" className="st-chip" aria-pressed={tab === 'structures'} onClick={() => setTab('structures')}>전개 공식 · {data.structures.length}</button><button type="button" className="st-chip" aria-pressed={tab === 'hooks'} onClick={() => setTab('hooks')}>첫 문장 공식 · {data.hooks.length}</button></div>
    <div className="st-lib">{items.map(item => <button type="button" key={item.id} className="st-lib-card" onClick={() => setOpen(item)}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><strong>{item.title}</strong><span className="st-pill st-pill-gray">릴스 {item.count}개</span></div>
      <p>{item.summary || item.formula}</p>
      {item.examples.length > 0 && <div className="st-row" style={{ gap: 6 }}>{item.examples.slice(0, 4).map(e => e.thumbnailUrl && <img key={e.id} src={e.thumbnailUrl} alt="" style={{ width: 36, height: 64, objectFit: 'cover', borderRadius: 6 }} />)}</div>}
    </button>)}</div>
  </div>
}
