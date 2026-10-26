import { useEffect, useState } from 'react'
import { ArrowLeft, Save, Play, Sparkles, ExternalLink } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount } from '../api'

// [대괄호] are the parts the student fills in; they are marked so the shape of a formula reads at a glance.
const marked = text => text.split(/(\[[^\]]+\])/).map((p, i) => /^\[/.test(p) ? <mark key={i}>{p}</mark> : p)

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
  const stories = data.structures.filter(s => s.template)
  const items = tab === 'hooks' ? data.hooks : tab === 'stories' ? stories : data.structures.filter(s => !s.template)
  const kind = tab === 'hooks' ? 'hook' : 'structure'
  if (open) {
    return <div className="st-stack" style={{ maxWidth: 860 }}>
      <button type="button" className="st-btn st-btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setOpen(null)}><ArrowLeft size={20} />공식 사전</button>
      <section className="st-card st-stack">
        <div className="st-card-head"><div><span className="st-pill">{tab === 'hooks' ? '첫 문장 공식' : open.template ? '스토리텔링 대본 템플릿' : '전개 공식'}</span><h2 style={{ marginTop: 8, fontSize: 24 }}>{open.title}</h2></div>
          <div className="st-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="st-btn st-btn-primary" onClick={() => go('new', { lib: open.id, kind })}><Sparkles size={18} />{open.template ? '이 틀로' : '이 공식으로'} 기획안 만들기</button>
            <button type="button" className="st-btn st-btn-soft" onClick={() => save(kind, open)}><Save size={18} />내 공식에 담기</button>
          </div></div>
        {open.summary && <p style={{ fontSize: 17 }}>{open.summary}</p>}
        {open.formula && <div className="st-kv"><span>공식</span><p className="st-formula">{marked(open.formula)}</p></div>}
        <div className="st-kv"><span>언제 쓰나</span><div>{open.when}</div></div>
        {open.example && <div className="st-kv"><span>예시</span><div>“{open.example}”</div></div>}
        {open.lines ? <div className="st-story-lines">{open.lines.map((l, i) => <article key={i} className="st-story-line">
            <div className="st-story-step"><b>{i + 1}단계</b><strong>{l.name}</strong><span className="st-muted">{l.purpose}</span></div>
            <p className="st-formula">“{marked(l.template)}”</p>
            {l.example && <p className="st-story-example"><span>예</span>{l.example}</p>}
          </article>)}<p className="st-muted st-small">출처: {open.source}. [대괄호]에 내 이야기를 넣으면 돼요.</p></div>
          : open.segments && <div className="st-kv"><span>흐름</span><div className="st-segments">{open.segments.map(([name, desc], i) => <div key={i}><strong>{name}</strong><span className="st-muted">{desc}</span></div>)}</div></div>}
      </section>
      <section className="st-card st-stack"><div className="st-card-head"><h3>{open.template ? '이 틀의 예시 영상' : '이 공식으로 터진 릴스'} <span className="st-muted st-small">· {open.count}개</span></h3></div>
        {open.examples.length === 0 ? <p className="st-muted">{open.template ? '이 틀에는 예시 영상이 없어요. 훅ai가 공부하며 찾으면 여기에 더해요.' : '아직 이 공식으로 분석된 릴스가 없어요. 매일 늘어나요.'}</p>
          : <div className="st-examples">{open.examples.map(e => e.instagramUrl
            ? <a key={e.id} className="st-example" href={e.instagramUrl} target="_blank" rel="noreferrer"><div className="st-example-ig"><ExternalLink size={26} /><span>인스타에서 보기</span></div><strong className="st-small">예시 영상</strong></a>
            : <button type="button" key={e.id} className="st-example" onClick={() => go('reference', { ref: e.id })}>{e.thumbnailUrl ? <img src={e.thumbnailUrl} alt="" loading="lazy" /> : <div style={{ aspectRatio: '9/16', borderRadius: 10, background: '#1b1825' }} />}<strong className="st-small">@{e.username}</strong>{e.views ? <span><Play size={11} /> {compactCount(e.views)}</span> : null}{e.hook && <span>“{e.hook}”</span>}</button>)}</div>}
      </section>
    </div>
  }
  return <div className="st-stack">
    <div className="st-page-head"><p>터진 릴스가 공통으로 쓰는 첫 문장·전개 공식이에요. 훅ai가 매일 성공 릴스를 공부하면서 공식마다 그 공식을 쓴 릴스를 채우고, 여러 릴스에서 되풀이되는 새 공식을 찾으면 여기에 더해요.</p></div>
    <div className="st-chips">
      <button type="button" className="st-chip" aria-pressed={tab === 'structures'} onClick={() => setTab('structures')}>전개 공식 · {data.structures.length - stories.length}</button>
      <button type="button" className="st-chip" aria-pressed={tab === 'stories'} onClick={() => setTab('stories')}>스토리텔링 대본 템플릿 · {stories.length}</button>
      <button type="button" className="st-chip" aria-pressed={tab === 'hooks'} onClick={() => setTab('hooks')}>첫 문장 공식 · {data.hooks.length}</button>
    </div>
    {tab === 'stories' && <p className="st-muted">내 경험·사연을 이야기로 풀 때 쓰는 대본 틀이에요. 단계마다 대본 틀과 예문이 있고, 예시 영상도 볼 수 있어요.</p>}
    <div className="st-lib">{items.map((item, n) => <button type="button" key={item.id} className="st-lib-card" onClick={() => setOpen(item)}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><strong>{item.template ? `${n + 1}. ` : ''}{item.title}</strong><span className="st-pill st-pill-gray">{item.template ? `예시 ${item.count}개` : `릴스 ${item.count}개`}</span></div>
      <p>{item.template ? item.when : item.summary || item.formula}</p>
      {item.template && <p className="st-muted st-small">{item.summary}</p>}
      {item.examples.length > 0 && <div className="st-row" style={{ gap: 6 }}>{item.examples.slice(0, 4).map(e => e.thumbnailUrl && <img key={e.id} src={e.thumbnailUrl} alt="" style={{ width: 36, height: 64, objectFit: 'cover', borderRadius: 6 }} />)}</div>}
    </button>)}</div>
  </div>
}
