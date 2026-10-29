import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, BookmarkCheck, Check, Copy, ExternalLink, Heart, LoaderCircle, MessageCircle, Play, RotateCcw, Sparkles, WandSparkles } from 'lucide-react'
import { creatorRequest } from '../lib/creatorApi'
import { PART, compactCount, day, planText } from '../lib/reelFormat'

export function InstagramIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></svg>
}

const ROLE = { hook: '후킹', problem: '문제 제기', empathy: '공감', evidence: '근거', method: '방법', twist: '반전', cta: '행동 유도', other: '전개' }
const TABS = [['script', '대본'], ['overview', '전체 분석'], ['hook', '후킹 분석'], ['structure', '구조 분석'], ['filming', '촬영 분석']]
const known = value => value && value !== '확인되지 않음'

function CopyButton({ text, label = '복사' }) {
  const [done, setDone] = useState(false)
  useEffect(() => { if (!done) return undefined; const id = setTimeout(() => setDone(false), 1600); return () => clearTimeout(id) }, [done])
  return <button type="button" className="ct-rd-copy" disabled={!text} onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true), () => {})}>
    {done ? <Check size={15} /> : <Copy size={15} />}{done ? '복사됨' : label}</button>
}

function Field({ label, children }) {
  if (!children || (typeof children === 'string' && !known(children))) return null
  return <div className="ct-rd-field"><span>{label}</span><div>{children}</div></div>
}

function Video({ shortcode, poster, permalink }) {
  const [state, setState] = useState({ url: null, failed: false })
  useEffect(() => {
    const controller = new AbortController()
    creatorRequest(`/creator-tools/success-reels/${shortcode}/playback`, { method: 'POST', signal: controller.signal })
      .then(data => setState({ url: data.media?.url || null, failed: !data.media?.url }))
      .catch(() => { if (!controller.signal.aborted) setState({ url: null, failed: true }) })
    return () => controller.abort()
  }, [shortcode])
  return <div className="ct-rd-video">
    {state.url && !state.failed ? <video src={state.url} poster={poster || undefined} controls autoPlay muted playsInline loop onError={() => setState(s => ({ ...s, failed: true }))} />
      : <>{poster && <img src={poster} alt="" />}{state.failed
        ? <a className="ct-rd-video-link" href={permalink} target="_blank" rel="noreferrer">인스타그램에서 보기 <ExternalLink size={15} /></a>
        : <span className="ct-rd-video-wait"><LoaderCircle size={22} className="ct-rd-spin" /></span>}</>}
  </div>
}

function ScriptTab({ analysis, caption, captionKo }) {
  const transcript = analysis.transcript || {}
  const foreign = transcript.original && transcript.language && !/^(ko|korean)$/i.test(transcript.language)
  const [showOriginal, setShowOriginal] = useState(false)
  const text = showOriginal ? transcript.original : transcript.korean
  const steps = analysis.structure?.steps || []
  const lines = String(text || '').split('\n').filter(Boolean)
  // Each structure step tags only the line where its quote starts, in transcript order.
  const roles = {}
  if (!showOriginal) {
    const squash = value => String(value || '').replace(/[\s.,!?~…"'“”‘’]/g, '')
    let from = 0
    for (const step of steps) {
      const head = squash(step.quote).slice(0, 10)
      const at = head ? lines.findIndex((line, i) => i >= from && squash(line).includes(head)) : -1
      if (at >= 0) { roles[at] = step.role; from = at + 1 }
    }
  }
  return <div className="ct-rd-stack">
    <section className="ct-rd-card">
      <header><h3>추출된 대본</h3><div className="ct-rd-actions">
        {foreign && <div className="ct-rd-toggle" role="group" aria-label="대본 언어">
          <button type="button" aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>한국어</button>
          <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>원문</button></div>}
        <CopyButton text={text} /></div></header>
      <ol className="ct-rd-lines">{lines.map((line, i) => { const role = roles[i]
        return <li key={i}>{role && <span className={`ct-rd-role ct-rd-role-${role}`}>{ROLE[role]}</span>}<span>{line}</span></li> })}</ol>
      {transcript.source === 'screen' && <p className="ct-muted ct-rd-note">말소리가 없어 화면 자막에서 읽었어요.</p>}
    </section>
    <section className="ct-rd-card">
      <header><h3>캡션</h3><CopyButton text={caption} /></header>
      <p className="ct-rd-pre">{caption || '캡션이 없는 릴스예요.'}</p>
      {captionKo && captionKo !== caption && <><h4>한국어 번역</h4><p className="ct-rd-pre ct-muted">{captionKo}</p></>}
    </section>
  </div>
}

function OverviewTab({ analysis, reel }) {
  const o = analysis.overview || {}
  const engagement = reel.views ? ((reel.likes || 0) + (reel.comments || 0)) / reel.views * 100 : null
  return <div className="ct-rd-stack">
    <section className="ct-rd-card ct-rd-lead"><h3>한눈에 보기</h3><p>{o.summary}</p></section>
    <div className="ct-rd-metrics">
      <div><span>조회수</span><strong>{compactCount(reel.views)}</strong></div>
      <div><span>좋아요</span><strong>{compactCount(reel.likes)}</strong></div>
      <div><span>댓글</span><strong>{compactCount(reel.comments)}</strong></div>
      <div><span>참여율</span><strong>{engagement == null ? '-' : `${engagement.toFixed(1)}%`}</strong></div>
      {analysis.durationSeconds ? <div><span>길이</span><strong>{analysis.durationSeconds}초</strong></div> : null}
    </div>
    <section className="ct-rd-card">
      <Field label="주제">{o.topic}</Field>
      <Field label="핵심 아이디어">{o.ideaSeed}</Field>
      <Field label="차별 포인트">{o.uniqueAngle}</Field>
    </section>
    {(known(o.commonBelief) || known(o.contrarianReality)) && <section className="ct-rd-card"><h3>통념과 반전</h3>
      <div className="ct-rd-flip"><div><span>시청자가 흔히 하는 생각</span><p>{o.commonBelief}</p></div><div><span>영상이 보여준 것</span><p>{o.contrarianReality}</p></div></div></section>}
    {o.evidence?.length > 0 && <section className="ct-rd-card"><header><h3>설득 포인트</h3><span className="ct-muted">주장을 믿게 하려고 영상이 이유로 든 내용이에요</span></header><ul className="ct-rd-bullets">{o.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></section>}
  </div>
}

function HookTab({ hook = {} }) {
  return <div className="ct-rd-stack">
    <section className="ct-rd-card ct-rd-lead"><span className="ct-rd-pill">{hook.category}</span>
      <h3 className="ct-rd-quote">“{hook.spokenHook}”</h3></section>
    <section className="ct-rd-card"><header><h3>첫 문장 공식</h3><CopyButton text={hook.formula} /></header>
      <p className="ct-rd-formula">{String(hook.formula || '').split(/(\[[^\]]+\])/).map((part, i) => /^\[/.test(part) ? <mark key={i}>{part}</mark> : part)}</p>
      <p className="ct-muted ct-rd-note">[ ] 자리에 내 주제를 넣어 바로 쓸 수 있어요.</p></section>
    <section className="ct-rd-card"><Field label="말로 하는 훅">{hook.spokenHook}</Field><Field label="화면 훅">{hook.visualHook}</Field></section>
    <section className="ct-rd-card"><h3>왜 붙잡나요</h3><p className="ct-rd-pre">{hook.analysis}</p></section>
  </div>
}

function StructureTab({ structure = {} }) {
  return <div className="ct-rd-stack">
    <section className="ct-rd-card ct-rd-lead"><span className="ct-rd-pill">{structure.category}</span><p>{structure.description}</p></section>
    <section className="ct-rd-card"><h3>흐름</h3><ol className="ct-rd-flow">{(structure.steps || []).map((step, i) =>
      <li key={i}><span className={`ct-rd-role ct-rd-role-${step.role}`}>{ROLE[step.role] || '전개'}</span><div><p className="ct-rd-flow-quote">“{step.quote}”</p><p className="ct-muted">{step.purpose}</p></div></li>)}</ol></section>
    <section className="ct-rd-card"><h3>내 영상에 적용하기</h3><p className="ct-rd-pre">{structure.analysis}</p></section>
  </div>
}

function FilmingTab({ filming = {} }) {
  return <div className="ct-rd-stack">
    <section className="ct-rd-card"><Field label="촬영 장소">{filming.location}</Field><Field label="구도·앵글">{filming.shotType}</Field>
      <Field label="화면에 나오는 것">{filming.onScreen}</Field><Field label="자막 스타일">{filming.textOverlay}</Field><Field label="편집">{filming.editing}</Field></section>
    {filming.guide?.length > 0 && <section className="ct-rd-card"><h3>이렇게 찍어보세요</h3><ol className="ct-rd-steps">{filming.guide.map((g, i) => <li key={i}>{g}</li>)}</ol></section>}
  </div>
}

function PlanResult({ plan, onNew }) {
  const [hookIndex, setHookIndex] = useState(0)
  const [checked, setChecked] = useState({})
  const hook = plan.hooks?.[hookIndex]
  const script = plan.script.map(line => line.part === 'hook' && hook ? { ...line, spoken: hook.spoken, onScreen: hook.onScreen || line.onScreen } : line)
  const total = plan.script.reduce((sum, line) => sum + (line.seconds || 0), 0)
  const captionText = [plan.caption.text, plan.caption.hashtags.map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n')
  return <div className="ct-rd-stack">
    {plan.thumbnailTitles?.length > 0 && <section className="ct-rd-card"><header><h3>썸네일 제목 추천</h3><span className="ct-muted">릴스 커버에 크게 넣을 제목이에요</span></header>
      <ol className="ct-rd-thumbs">{plan.thumbnailTitles.map((t, i) => <li key={i}><div className="ct-rd-thumb-cover">{t.label && <span className="ct-rd-thumb-label">{t.label}</span>}<strong>{t.text}</strong></div>
        <div className="ct-rd-thumb-meta">{t.why && <p className="ct-muted">{t.why}</p>}<CopyButton text={t.text} /></div></li>)}</ol></section>}
    <section className="ct-rd-card ct-rd-plan-head">
      <div><span className="ct-rd-pill"><Sparkles size={13} />내 기획안 · 약 {total}초</span><h3>{plan.title}</h3></div>
      <div className="ct-rd-actions"><CopyButton text={planText(plan, hookIndex)} label="전체 복사" /><button type="button" className="ct-rd-ghost" onClick={onNew}><RotateCcw size={15} />다시 만들기</button></div>
    </section>
    {plan.placeholders?.length > 0 && <p className="ct-rd-fill">촬영 전에 채워 주세요: {plan.placeholders.map(p => <mark key={p}>{p}</mark>)}</p>}
    {plan.hooks?.length > 0 && <section className="ct-rd-card"><header><h3>훅 고르기</h3><span className="ct-muted">고른 훅이 대본 첫 줄에 들어가요</span></header>
      <div className="ct-rd-hooks">{plan.hooks.map((h, i) => <button type="button" key={i} className="ct-rd-hook" aria-pressed={hookIndex === i} onClick={() => setHookIndex(i)}>
        <strong>{h.spoken}</strong>{h.onScreen && <span>자막 · {h.onScreen}</span>}{h.why && <small>{h.why}</small>}</button>)}</div></section>}
    <section className="ct-rd-card"><header><h3>대본</h3><CopyButton text={script.map(l => l.spoken).join('\n')} /></header>
      <ol className="ct-rd-script">{script.map((line, i) => <li key={i}><span className={`ct-rd-part ct-rd-part-${line.part}`}>{PART[line.part]}<small>{line.seconds}초</small></span>
        <div><p>{line.spoken}</p>{line.onScreen && <p className="ct-muted">자막 · {line.onScreen}</p>}</div></li>)}</ol></section>
    <section className="ct-rd-card"><header><h3>스토리보드</h3><span className="ct-muted">{plan.storyboard.length}컷</span></header>
      <ol className="ct-rd-board">{plan.storyboard.map(s => <li key={s.scene}>
        <div className="ct-rd-board-top"><strong>#{s.scene}</strong><span>{s.seconds}초</span></div>
        <p className="ct-rd-board-shot">{s.shot}</p><p>{s.action}</p>
        {s.onScreen && <p className="ct-rd-board-text">{s.onScreen}</p>}
        {s.spoken && <p className="ct-muted">“{s.spoken}”</p>}</li>)}</ol></section>
    <section className="ct-rd-card"><h3>촬영 가이드</h3>
      <Field label="장소">{plan.filming.location}</Field>
      {plan.filming.props.length > 0 && <Field label="준비물"><div className="ct-rd-tags">{plan.filming.props.map(p => <span key={p}>{p}</span>)}</div></Field>}
      <Field label="카메라">{plan.filming.camera}</Field><Field label="조명">{plan.filming.lighting}</Field><Field label="편집">{plan.filming.editing}</Field>
      {plan.filming.checklist.length > 0 && <ul className="ct-rd-check">{plan.filming.checklist.map((c, i) => <li key={i}><label>
        <input type="checkbox" checked={!!checked[i]} onChange={e => setChecked(prev => ({ ...prev, [i]: e.target.checked }))} /><span>{c}</span></label></li>)}</ul>}
    </section>
    <section className="ct-rd-card"><header><h3>캡션</h3><CopyButton text={captionText} /></header>
      <p className="ct-rd-pre">{plan.caption.text}</p>
      {plan.caption.hashtags.length > 0 && <p className="ct-rd-hashtags">{plan.caption.hashtags.map(t => `#${t}`).join(' ')}</p>}</section>
  </div>
}

function PlanStudio({ shortcode, analysis, plans, initialPlanId, onPlansChange }) {
  const [brief, setBrief] = useState('')
  const [activeId, setActiveId] = useState(plans.some(p => p.id === initialPlanId) ? initialPlanId : plans[0]?.id || null)
  const [composing, setComposing] = useState(!plans.length)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const active = plans.find(p => p.id === activeId)
  const runningId = plans.find(p => p.status === 'running')?.id
  useEffect(() => {
    if (!runningId) return undefined
    const timer = setInterval(() => {
      creatorRequest(`/creator-tools/success-reel-plans/${runningId}`).then(row => {
        if (row.status !== 'running') onPlansChange(list => list.map(p => p.id === row.id ? { ...p, ...row } : p))
      }).catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [runningId, onPlansChange])
  async function submit(event) {
    event?.preventDefault()
    if (brief.trim().length < 5 || submitting) return
    setSubmitting(true); setError('')
    try {
      const row = await creatorRequest(`/creator-tools/success-reels/${shortcode}/plans`, { method: 'POST', body: { brief: brief.trim() } })
      onPlansChange(list => [{ id: row.id, brief: brief.trim(), status: row.status, plan: null, error: null, createdAt: row.createdAt }, ...list])
      setActiveId(row.id); setComposing(false); setBrief('')
    } catch (e) { setError(e.message) } finally { setSubmitting(false) }
  }
  const hook = analysis.hook || {}, structure = analysis.structure || {}
  return <div className="ct-rd-stack">
    {plans.length > 0 && <div className="ct-rd-history" role="group" aria-label="내 기획안 목록">
      <button type="button" aria-pressed={composing} onClick={() => setComposing(true)}><WandSparkles size={14} />새 기획안</button>
      {plans.map((p, i) => <button type="button" key={p.id} aria-pressed={!composing && activeId === p.id} onClick={() => { setActiveId(p.id); setComposing(false) }}>
        {p.status === 'running' && <LoaderCircle size={13} className="ct-rd-spin" />}{p.plan?.title || p.brief.slice(0, 18)}{i === 0 && p.status === 'ready' ? ' · 최신' : ''}</button>)}
    </div>}
    {composing || !active ? <form className="ct-rd-card ct-rd-compose" onSubmit={submit}>
      <h3>이 릴스 공식으로 내 기획안 만들기</h3>
      <div className="ct-rd-borrow"><span>빌려올 것</span><mark>{hook.category} 훅</mark><mark>{structure.category} 전개</mark>{analysis.durationSeconds ? <mark>약 {analysis.durationSeconds}초</mark> : null}</div>
      <textarea value={brief} onChange={e => setBrief(e.target.value)} maxLength={4000} rows={7} autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
        placeholder={'이번 릴스에 담고 싶은 내용을 자유롭게 적어주세요.\n\n예) 30대 지성 피부인 제가 3주 동안 써본 선크림 3개를 솔직하게 비교하고 싶어요. 제일 좋았던 건 ○○이고, 백탁이 없어서요.'}
        aria-label="이번 릴스에 담고 싶은 내용" />
      <p className="ct-muted ct-rd-note">적어주신 내용에 없는 경험·수치는 지어내지 않고 [ ]로 비워 둬요. 훅 3개, 대본, 스토리보드, 촬영 가이드, 캡션을 한 번에 만들어요.</p>
      {error && <div role="alert" className="ct-error">{error}</div>}
      <button type="submit" className="ct-rd-primary" disabled={brief.trim().length < 5 || submitting}>{submitting ? <LoaderCircle size={17} className="ct-rd-spin" /> : <Sparkles size={17} />}기획안 만들기</button>
    </form> : active.status === 'running' ? <section className="ct-rd-card ct-rd-making" role="status">
      <LoaderCircle size={26} className="ct-rd-spin" /><div><h3>기획안을 만들고 있어요</h3><p className="ct-muted">보통 30초~1분 걸려요. 이 화면을 떠나도 계속 만들어져요.</p><p className="ct-rd-brief">“{active.brief}”</p></div>
    </section> : active.status === 'failed' ? <section className="ct-rd-card" role="alert"><h3>기획안을 만들지 못했어요</h3><p className="ct-muted">{active.error || '잠시 후 다시 시도해주세요.'}</p>
      <button type="button" className="ct-rd-primary" onClick={() => { setBrief(active.brief); setComposing(true) }}>내용 그대로 다시 만들기</button></section>
      : <PlanResult key={active.id} plan={active.plan} onNew={() => { setBrief(active.brief); setComposing(true) }} />}
  </div>
}

export default function ReelDetail({ shortcode, preview, initialTab = 'script', initialPlanId = null, onBack, onSaved, onAnalyze }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(initialTab || 'script')
  const [plans, setPlans] = useState([])
  const top = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    creatorRequest(`/creator-tools/success-reels/${shortcode}`, { signal: controller.signal })
      .then(data => { setDetail(data); setPlans(data.plans || []) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [shortcode])
  useEffect(() => { top.current?.scrollIntoView({ block: 'start' }) }, [])
  const reel = detail || preview || {}
  const saved = detail?.saved ?? preview?.saved ?? false
  const analysis = detail?.analysis
  async function toggleSave() {
    const next = !saved
    setDetail(d => d && { ...d, saved: next })
    try { await creatorRequest(`/creator-tools/success-reels/${shortcode}/save`, { method: 'PUT', body: { saved: next } }); onSaved?.(shortcode, next) }
    catch { setDetail(d => d && { ...d, saved: !next }) }
  }
  const body = !analysis ? null : (() => {
    if (tab === 'plan') return <PlanStudio shortcode={shortcode} analysis={analysis} plans={plans} initialPlanId={initialPlanId} onPlansChange={setPlans} />
    if (tab === 'overview') return <OverviewTab analysis={analysis} reel={reel} />
    if (tab === 'hook') return <HookTab hook={analysis.hook} />
    if (tab === 'structure') return <StructureTab structure={analysis.structure} />
    if (tab === 'filming') return <FilmingTab filming={analysis.filming} />
    return <ScriptTab analysis={analysis} caption={reel.caption} captionKo={reel.captionKo} />
  })()
  return <section className="ct-rd" ref={top}>
    <div className="ct-rd-bar">
      <button type="button" className="ct-rd-back" onClick={onBack}><ArrowLeft size={18} />성공 릴스</button>
      {analysis && <button type="button" className="ct-rd-primary" onClick={() => setTab('plan')}><Sparkles size={17} />내 기획안 만들기</button>}
    </div>
    <div className="ct-rd-layout">
      <aside className="ct-rd-side">
        <Video shortcode={shortcode} poster={reel.thumbnailUrl} permalink={reel.permalink || `https://www.instagram.com/reel/${shortcode}/`} />
        <div className="ct-rd-owner">
          <a href={`https://www.instagram.com/${reel.username}/`} target="_blank" rel="noreferrer">@{reel.username}</a>
          <div className="ct-rd-icons">
            <a className="ct-rd-icon" href={reel.permalink || `https://www.instagram.com/reel/${shortcode}/`} target="_blank" rel="noreferrer" aria-label="인스타그램에서 열기" data-tip="인스타그램에서 열기"><InstagramIcon /></a>
            <button type="button" className="ct-rd-icon" aria-pressed={saved} aria-label={saved ? '저장 취소' : '저장하기'} data-tip={saved ? '저장 취소' : '저장하기'} onClick={toggleSave}>{saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}</button>
          </div>
        </div>
        <div className="ct-rd-stats"><span><Play size={14} />{compactCount(reel.views)}</span><span><Heart size={14} />{compactCount(reel.likes)}</span><span><MessageCircle size={14} />{compactCount(reel.comments)}</span><span>{day(reel.postedAt)}</span></div>
      </aside>
      <div className="ct-rd-main">
        {error ? <div role="alert" className="ct-error">{error}</div>
          : !detail ? <p role="status" className="ct-muted">불러오는 중…</p>
            : !analysis ? <section className="ct-rd-card ct-rd-making">
              {detail.analysisStatus === 'running' ? <><LoaderCircle size={26} className="ct-rd-spin" /><div><h3>분석 중이에요</h3><p className="ct-muted">보통 1~2분 걸려요. 끝나면 알려드릴게요.</p></div></>
                : <div><h3>{detail.analysisStatus === 'failed' ? '분석하지 못했어요' : '아직 분석하지 않은 릴스예요'}</h3>{detail.analysisError && <p className="ct-muted">{detail.analysisError}</p>}
                  <button type="button" className="ct-rd-primary" onClick={() => { onAnalyze?.(reel); setDetail(d => ({ ...d, analysisStatus: 'running' })) }}><Sparkles size={17} />분석하기</button></div>}
            </section>
              : <>
                <nav className="ct-rd-tabs" aria-label="분석 보기">{TABS.map(([id, label]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
                  <button type="button" className="ct-rd-tab-plan" aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}><Sparkles size={14} />내 기획안</button></nav>
                {body}
              </>}
      </div>
    </div>
  </section>
}
