import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, Heart, MessageCircle, Play, Sparkles, LoaderCircle, Save } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount, day } from '../api'
import { InstagramIcon } from './ReelsPage'
import HookLoader from '../HookLoader'

const ROLE = { hook: '첫 문장', problem: '문제 제기', empathy: '공감', evidence: '근거', method: '방법', twist: '반전', cta: '마무리', other: '전개' }
const TABS = [['script', '대본'], ['overview', '한눈에'], ['hook', '첫 문장'], ['structure', '전개'], ['filming', '촬영/편집'], ['caption', '캡션']]
const known = v => v && v !== '확인되지 않음'
// Older analyses hold one long paragraph: split it into readable lines and pull out "(1) … (2) …" steps.
const sentences = value => String(value || '').split(/(?<=[.다요]\.)\s+|(?<=니다\.)\s+/).map(v => v.trim()).filter(Boolean)
function Readable({ text, steps }) {
  if (steps?.length) return <ol className="st-steps">{steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
  const value = String(text || '')
  const numbered = value.split(/\s*\(\d+\)\s*/).map(v => v.trim()).filter(Boolean)
  if (numbered.length >= 3) { const [lead, ...rest] = value.includes('(1)') && !value.trim().startsWith('(1)') ? numbered : ['', ...numbered]
    const leadLines = sentences(lead.replace(/\s*적용 방법[:：]?\s*본인 주제도\s*$|[:：]\s*$/, ''))
    return <>{leadLines.length > 0 && <ul className="st-lines-read" style={{ marginBottom: 14 }}>{leadLines.map((l, i) => <li key={i}>{l}</li>)}</ul>}<p className="st-muted st-small" style={{ marginBottom: 8 }}>내 주제에 적용하는 순서</p><ol className="st-steps">{rest.map((t, i) => <li key={i}>{t.replace(/[.。]\s*$/, '')}</li>)}</ol></> }
  return <ul className="st-lines-read">{sentences(value).map((l, i) => <li key={i}>{l}</li>)}</ul>
}

export function CopyButton({ text, label = '복사' }) {
  const [done, setDone] = useState(false)
  useEffect(() => { if (!done) return undefined; const id = setTimeout(() => setDone(false), 1500); return () => clearTimeout(id) }, [done])
  return <button type="button" className="st-copy" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}>{done ? <Check size={15} /> : <Copy size={15} />}{done ? '복사됨' : label}</button>
}
const KV = ({ label, children }) => !children || (typeof children === 'string' && !known(children)) ? null : <div className="st-kv"><span>{label}</span><div>{children}</div></div>

function Video({ shortcode, poster, permalink }) {
  const [state, setState] = useState({ url: null, failed: false })
  useEffect(() => {
    let alive = true
    studio.playback(shortcode).then(d => alive && setState({ url: d.media?.url || null, failed: !d.media?.url })).catch(() => alive && setState({ url: null, failed: true }))
    return () => { alive = false }
  }, [shortcode])
  return <div className="st-video">
    {state.url && !state.failed ? <video src={state.url} poster={poster || undefined} controls autoPlay muted playsInline loop onError={() => setState(s => ({ ...s, failed: true }))} />
      : <>{poster && <img src={poster} alt="" />}{state.failed ? (permalink ? <a className="st-video-link" href={permalink} target="_blank" rel="noreferrer">인스타그램에서 보기</a> : <span className="st-video-link">영상을 불러오지 못했어요</span>) : <span className="st-video-link" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}><LoaderCircle size={18} className="st-spin" /></span>}</>}
  </div>
}

export function AnalysisTabs({ reel, analysis, tab, setTab, onSaveFormula }) {
  const saveBtn = kind => onSaveFormula ? <button type="button" className="st-btn st-btn-sm" onClick={() => onSaveFormula(kind)}><Save size={15} />내 공식으로 저장</button> : null
  const transcript = analysis.transcript || {}
  const [orig, setOrig] = useState(false)
  const foreign = transcript.original && transcript.language && !/^(ko|korean)$/i.test(transcript.language)
  const text = orig ? transcript.original : transcript.korean
  const lines = String(text || '').split('\n').filter(Boolean)
  const roles = {}
  if (!orig) { const squash = v => String(v || '').replace(/[\s.,!?~…"'“”‘’]/g, ''); let from = 0
    for (const step of analysis.structure?.steps || []) { const head = squash(step.quote).slice(0, 10); const at = head ? lines.findIndex((l, i) => i >= from && squash(l).includes(head)) : -1; if (at >= 0) { roles[at] = step.role; from = at + 1 } } }
  const o = analysis.overview || {}, h = analysis.hook || {}, s = analysis.structure || {}, f = analysis.filming || {}, c = analysis.caption
  const e = analysis.editing || { subtitleStyle: f.textOverlay, cuts: f.editing, transitions: '', effects: '', sound: '', guide: [] }
  const engagement = reel.views ? ((reel.likes || 0) + (reel.comments || 0)) / reel.views * 100 : null
  return <>
    <nav className="st-tabs" aria-label="분석 보기">{TABS.map(([id, label]) => <button type="button" key={id} className="st-tab" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'script' && <div className="st-stack">
      <section className="st-card"><div className="st-card-head"><h3>추출된 대본</h3><div className="st-row">{foreign && <div className="st-chips"><button type="button" className="st-chip st-btn-sm" aria-pressed={!orig} onClick={() => setOrig(false)}>한국어</button><button type="button" className="st-chip" aria-pressed={orig} onClick={() => setOrig(true)}>원문</button></div>}<CopyButton text={text} /></div></div>
        <ol className="st-transcript">{lines.map((line, i) => <li key={i}>{roles[i] && <span className={`st-role st-role-${roles[i]}`}>{ROLE[roles[i]]}</span>}<span>{line}</span></li>)}</ol>
        {transcript.source === 'screen' && <p className="st-muted st-small" style={{ marginTop: 10 }}>말소리가 없어 화면 자막에서 읽었어요.</p>}</section>
      <section className="st-card"><div className="st-card-head"><h3>캡션</h3><CopyButton text={reel.caption} /></div><p style={{ whiteSpace: 'pre-wrap' }}>{reel.caption || '캡션이 없는 릴스예요.'}</p>{reel.captionKo && reel.captionKo !== reel.caption && <p className="st-muted" style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>번역: {reel.captionKo}</p>}</section>
    </div>}
    {tab === 'overview' && <div className="st-stack">
      <section className="st-card"><h3 style={{ marginBottom: 8 }}>한눈에 보기</h3><p style={{ fontSize: 17 }}>{o.summary}</p></section>
      <div className="st-metrics"><div><span>조회수</span><strong>{compactCount(reel.views)}</strong></div><div><span>좋아요</span><strong>{compactCount(reel.likes)}</strong></div><div><span>댓글</span><strong>{compactCount(reel.comments)}</strong></div><div><span>참여율</span><strong>{engagement == null ? '-' : `${engagement.toFixed(1)}%`}</strong></div>{analysis.durationSeconds ? <div><span>길이</span><strong>{analysis.durationSeconds}초</strong></div> : null}</div>
      <section className="st-card"><KV label="주제">{o.topic}</KV><KV label="핵심 아이디어">{o.ideaSeed}</KV><KV label="차별 포인트">{o.uniqueAngle}</KV></section>
      {(known(o.commonBelief) || known(o.contrarianReality)) && <section className="st-card"><h3 style={{ marginBottom: 12 }}>통념과 반전</h3><div className="st-grid-2"><div className="st-note st-pill-gray" style={{ background: 'var(--st-bg)', color: 'var(--st-text)' }}><strong className="st-small st-muted">시청자가 흔히 하는 생각</strong><p>{o.commonBelief}</p></div><div className="st-note"><strong className="st-small">영상이 보여준 것</strong><p>{o.contrarianReality}</p></div></div></section>}
      {o.evidence?.length > 0 && <section className="st-card"><div className="st-card-head"><h3>설득 포인트</h3><p>주장을 믿게 하려고 영상이 이유로 든 내용</p></div><ul className="st-lines-read">{o.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></section>}
    </div>}
    {tab === 'hook' && <div className="st-stack">
      <section className="st-card"><div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{h.category}</span>{saveBtn('hook')}</div><h2 style={{ marginTop: 10, fontSize: 24, lineHeight: 1.45 }}>“{h.spokenHook}”</h2></section>
      <section className="st-card"><div className="st-card-head"><h3>내 주제에 쓰는 훅 공식</h3><CopyButton text={h.formula} /></div><p className="st-formula">{String(h.formula || '').split(/(\[[^\]]+\])/).map((p, i) => /^\[/.test(p) ? <mark key={i}>{p}</mark> : p)}</p><p className="st-muted st-small" style={{ marginTop: 8 }}>[ ] 자리에 내 주제를 넣어 바로 쓸 수 있어요.</p></section>
      <section className="st-card"><KV label="말로 하는 훅">{h.spokenHook}</KV><KV label="화면 훅">{h.visualHook}</KV></section>
      <section className="st-card"><h3 style={{ marginBottom: 8 }}>왜 붙잡나요</h3><Readable text={h.analysis} /></section>
      {h.apply?.length > 0 && <section className="st-card"><h3 style={{ marginBottom: 10 }}>내 주제로 따라 하기</h3><ol className="st-steps">{h.apply.map((t, i) => <li key={i}>{t}</li>)}</ol></section>}
    </div>}
    {tab === 'structure' && <div className="st-stack">
      <section className="st-card"><div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{s.category}</span>{saveBtn('structure')}</div><p style={{ marginTop: 10, fontSize: 17 }}>{s.description}</p></section>
      <section className="st-card"><h3 style={{ marginBottom: 12 }}>흐름</h3><ol className="st-transcript">{(s.steps || []).map((step, i) => <li key={i} style={{ alignItems: 'flex-start' }}><span className={`st-role st-role-${step.role}`}>{ROLE[step.role] || '전개'}</span><div><strong>“{step.quote}”</strong><p className="st-muted st-small">{step.purpose}</p></div></li>)}</ol></section>
      <section className="st-card"><h3 style={{ marginBottom: 8 }}>왜 효과적인가요</h3><Readable text={s.apply?.length ? s.analysis : s.analysis} /></section>
      {s.apply?.length > 0 && <section className="st-card"><h3 style={{ marginBottom: 10 }}>내 영상에 적용하기</h3><ol className="st-steps">{s.apply.map((t, i) => <li key={i}>{t}</li>)}</ol></section>}
    </div>}
    {tab === 'filming' && <div className="st-stack">
      <section className="st-card"><div className="st-card-head"><h3>촬영</h3>{saveBtn('filming')}</div><KV label="촬영 장소">{f.location}</KV><KV label="구도·앵글">{f.shotType}</KV><KV label="화면에 나오는 것">{f.onScreen}</KV></section>
      {f.guide?.length > 0 && <section className="st-card"><h3 style={{ marginBottom: 10 }}>이렇게 찍어보세요</h3><ol className="st-steps">{f.guide.map((g, i) => <li key={i}>{g}</li>)}</ol></section>}
      <section className="st-card"><div className="st-card-head"><h3>편집</h3></div><KV label="자막 스타일">{e.subtitleStyle}</KV><KV label="컷·템포">{e.cuts}</KV><KV label="전환">{e.transitions}</KV><KV label="효과">{e.effects}</KV><KV label="사운드">{e.sound}</KV>
        {!analysis.editing && <p className="st-muted st-small" style={{ marginTop: 10 }}>이 릴스는 편집 분석이 추가되기 전에 분석됐어요. 자막·컷 정보만 보여요.</p>}</section>
      {e.guide?.length > 0 && <section className="st-card"><h3 style={{ marginBottom: 10 }}>이렇게 편집해보세요</h3><ol className="st-steps">{e.guide.map((g, i) => <li key={i}>{g}</li>)}</ol></section>}
    </div>}
    {tab === 'caption' && <div className="st-stack">
      {c ? <section className="st-card"><KV label="첫 줄 장치">{c.firstLine}</KV><KV label="본문 구성">{c.structure}</KV><KV label="마무리 유도">{c.cta}</KV><KV label="해시태그 전략">{c.hashtags}</KV><KV label="역할">{c.analysis}</KV></section>
        : <div className="st-note">이 릴스는 캡션 분석이 추가되기 전에 분석됐어요. 캡션 원문은 '대본' 탭에서 볼 수 있어요.</div>}
      <section className="st-card"><div className="st-card-head"><h3>캡션 원문</h3><div className="st-row"><CopyButton text={reel.caption} />{saveBtn('caption')}</div></div><p style={{ whiteSpace: 'pre-wrap' }}>{reel.caption || '캡션이 없는 릴스예요.'}</p></section>
    </div>}
  </>
}

// The server reports only running/ready; the stage shown follows how long the analysis has run.
const ANALYSIS_STAGES = ['영상 가져오기', '대본 읽기', '첫 문장·전개·촬영·캡션 분석']
const analysisStage = startedAt => { const s = startedAt ? (Date.now() - Date.parse(startedAt)) / 1000 : 0; return s < 20 ? 0 : s < 60 ? 1 : 2 }

export default function ReferenceDetail({ shortcode }) {
  const { go, analyze, tracking, toast } = useStudio()
  const saveFormula = async kind => { try { const r = await studio.saveFormula({ kind, shortcode }); toast({ kind: 'ready', title: '내 공식에 저장했어요', body: r.formula.title, action: { label: '내 공식 보기', onClick: () => go('formulas') } }) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) } }
  const [reel, setReel] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('script')
  const running = Boolean(tracking[shortcode]) || reel?.analysisStatus === 'running'
  useEffect(() => {
    let alive = true
    const load = () => studio.reel(shortcode).then(d => alive && setReel(d)).catch(e => alive && setError(e.message))
    load()
    const timer = setInterval(() => { if (running) load() }, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [shortcode, running])
  if (error) return <div className="st-error" role="alert">{error}</div>
  if (!reel) return <p className="st-muted">불러오는 중…</p>
  const analysis = reel.analysisStatus === 'ready' ? reel.analysis : null
  return <div className="st-stack">
    <div className="st-row" style={{ justifyContent: 'space-between' }}>
      <button type="button" className="st-btn st-btn-ghost" onClick={() => go('reels')}><ArrowLeft size={20} />성공 릴스</button>
      {analysis && <button type="button" className="st-btn st-btn-primary st-btn-big" onClick={() => go('new', { ref: shortcode })}><Sparkles size={20} />이 레퍼런스로 기획안 만들기</button>}
    </div>
    <div className="st-detail">
      <aside className="st-stack" style={{ gap: 12 }}>
        {reel.source === 'upload-text' ? <div className="st-card st-stack" style={{ gap: 8 }}><span className="st-pill st-pill-gray">내가 넣은 대본</span><strong style={{ fontSize: 18 }}>{reel.title}</strong><p className="st-muted st-small">영상 없이 대본만으로 분석했어요.</p></div>
          : <Video shortcode={shortcode} poster={reel.thumbnailUrl} permalink={reel.permalink} />}
        {reel.permalink ? <div className="st-row" style={{ justifyContent: 'space-between' }}><a href={`https://www.instagram.com/${reel.username}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 800, color: 'var(--st-text)' }}>@{reel.username}</a><a className="st-btn st-btn-sm" href={reel.permalink} target="_blank" rel="noreferrer"><InstagramIcon size={17} />인스타그램에서 보기</a></div>
          : <div className="st-row" style={{ justifyContent: 'space-between' }}><strong>{reel.title || '내 레퍼런스'}</strong><span className="st-pill st-pill-gray">나만 보여요</span></div>}
        {reel.permalink && <div className="st-row st-muted st-small" style={{ gap: 14 }}><span><Play size={14} /> {compactCount(reel.views)}</span><span><Heart size={14} /> {compactCount(reel.likes)}</span><span><MessageCircle size={14} /> {compactCount(reel.comments)}</span><span>{day(reel.postedAt)}</span></div>}
      </aside>
      <div className="st-stack">
        {analysis ? <AnalysisTabs reel={reel} analysis={analysis} tab={tab} setTab={setTab} onSaveFormula={saveFormula} />
          : running ? <HookLoader title="훅ai가 분석하는 중" stages={ANALYSIS_STAGES} stageIndex={analysisStage(tracking[shortcode] ? null : reel.analysisUpdatedAt)} startedAt={tracking[shortcode] ? null : reel.analysisUpdatedAt} note="보통 1~2분 걸려요. 이 화면을 떠나도 계속 분석되고, 끝나면 알려드릴게요." />
          : <div className="st-card st-stack"><h3>{reel.analysisStatus === 'failed' ? '분석하지 못했어요' : '아직 분석하지 않은 릴스예요'}</h3>{reel.analysisError && <p className="st-muted">{reel.analysisError}</p>}<button type="button" className="st-btn st-btn-primary st-btn-big" style={{ justifySelf: 'start' }} onClick={() => analyze(reel)}><Sparkles size={20} />분석하기</button></div>}
      </div>
    </div>
  </div>
}
