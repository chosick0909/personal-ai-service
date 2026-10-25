import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, CheckCircle2, ExternalLink, LoaderCircle, Play, X, Heart, MessageCircle, Music2, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { creatorRequest } from '../lib/creatorApi'
import ReelDetail, { InstagramIcon } from './ReelDetail'
import { compactCount, day } from '../lib/reelFormat'
import './CreatorTools.css'

const FACE = [['any', '얼굴 전체'], ['visible', '얼굴 공개'], ['mixed', '얼굴 일부'], ['hidden', '얼굴 비공개']]
const REGION = [['any', '국내·해외'], ['domestic', '국내'], ['overseas', '해외']]
const SORT = [['latest', '최신순'], ['views', '조회수순']]

const updatedAt = value => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Chips({ label, options, value, onChange }) {
  return <div className="ct-reels-chips" role="group" aria-label={label}>{options.map(([id, text]) =>
    <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>
}

function Player({ reel, onClose, onAnalyze }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const closeButton = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    closeButton.current?.focus()
    creatorRequest(`/creator-tools/success-reels/${reel.shortcode}/playback`, { method: 'POST', signal: controller.signal })
      .then(data => { if (data.media?.url) setUrl(data.media.url); else setFailed(true) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [reel.shortcode])
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="ct-reels-modal" role="dialog" aria-modal="true" aria-label={`@${reel.username} 릴스`} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="ct-reels-player">
      <button ref={closeButton} type="button" className="ct-reels-close" aria-label="닫기" onClick={onClose}><X size={20} /></button>
      <div className="ct-reels-video">
        {url && !failed ? <video src={url} controls autoPlay playsInline onError={() => setFailed(true)} />
          : failed ? <div className="ct-reels-fallback">{reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt="" />}<a href={reel.permalink} target="_blank" rel="noreferrer">인스타그램에서 보기 <ExternalLink size={15} /></a></div>
            : <div className="ct-reels-loading">불러오는 중…</div>}
      </div>
      <div className="ct-reels-meta">
        <a className="ct-reels-user" href={`https://www.instagram.com/${reel.username}/`} target="_blank" rel="noreferrer">@{reel.username}</a>
        <div className="ct-reels-stats"><span><Play size={14} />{compactCount(reel.views)}</span><span><Heart size={14} />{compactCount(reel.likes)}</span><span><MessageCircle size={14} />{compactCount(reel.comments)}</span><span>{day(reel.postedAt)}</span></div>
        {reel.audio && <p className="ct-reels-audio"><Music2 size={14} />{reel.audio}</p>}
        <p>{reel.caption}</p>
        {reel.captionKo && <p className="ct-muted">번역: {reel.captionKo}</p>}
        <button type="button" className="ct-rd-primary" disabled={reel.analysisStatus === 'running'} onClick={onAnalyze}><Sparkles size={16} />{reel.analysisStatus === 'running' ? '분석 중…' : '이 릴스 분석하기'}</button>
        <a className="ct-reels-origin" href={reel.permalink} target="_blank" rel="noreferrer">인스타그램 원문 열기 <ExternalLink size={14} /></a>
      </div>
    </div>
  </div>
}

export default function SuccessReels({ categories = [], open: initialOpen = null }) {
  const [filters, setFilters] = useState({ category: 'all', face: 'any', region: 'any', sort: 'latest', q: '', saved: false, analyzed: false })
  const [draft, setDraft] = useState('')
  const [reels, setReels] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [detail, setDetail] = useState(initialOpen)
  const [tracking, setTracking] = useState({})
  const view = useRef({ open: null, detail: null })
  useEffect(() => { view.current = { open, detail } }, [open, detail])
  const gridScroll = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ sort: filters.sort, page: String(page) })
    if (filters.category !== 'all') params.set('category', filters.category)
    if (filters.face !== 'any') params.set('face', filters.face)
    if (filters.region !== 'any') params.set('region', filters.region)
    if (filters.q) params.set('q', filters.q)
    if (filters.saved) params.set('saved', '1')
    if (filters.analyzed) params.set('analyzed', '1')
    creatorRequest(`/creator-tools/success-reels?${params}`, { signal: controller.signal })
      .then(data => { setReels(previous => page === 0 ? data.reels : [...previous, ...data.reels]); setHasMore(data.hasMore); if (page === 0 && data.lastUpdatedAt) setLastUpdatedAt(data.lastUpdatedAt) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, page])
  const change = patch => { setFilters(previous => ({ ...previous, ...patch })); setPage(0); setLoading(true); setError('') }
  const patchReel = useCallback((shortcode, patch) => setReels(list => list.map(r => r.shortcode === shortcode ? { ...r, ...patch } : r)), [])
  const showDetail = useCallback(reel => { gridScroll.current = window.scrollY; setOpen(null); setDetail(reel) }, [])
  const closeDetail = () => { setDetail(null); requestAnimationFrame(() => window.scrollTo(0, gridScroll.current)) }
  const dismiss = shortcode => setTracking(t => { const next = { ...t }; delete next[shortcode]; return next })

  const analyze = useCallback(async reel => {
    setTracking(t => ({ ...t, [reel.shortcode]: { reel, status: 'running' } }))
    patchReel(reel.shortcode, { analysisStatus: 'running' })
    try {
      const result = await creatorRequest(`/creator-tools/success-reels/${reel.shortcode}/analysis`, { method: 'POST' })
      if (result.status === 'ready') {
        patchReel(reel.shortcode, { analysisStatus: 'ready' })
        setTracking(t => { const next = { ...t }; delete next[reel.shortcode]; return next })
        showDetail({ ...reel, analysisStatus: 'ready' })
      }
    } catch (e) {
      patchReel(reel.shortcode, { analysisStatus: 'failed' })
      setTracking(t => ({ ...t, [reel.shortcode]: { reel, status: 'failed', error: e.message } }))
    }
  }, [patchReel, showDetail])

  const running = Object.entries(tracking).filter(([, item]) => item.status === 'running').map(([code]) => code).join(',')
  useEffect(() => {
    if (!running) return undefined
    const codes = running.split(',')
    const started = Date.now()
    const timer = setInterval(() => {
      if (Date.now() - started > 20 * 60000) { clearInterval(timer); return }
      for (const code of codes) {
        creatorRequest(`/creator-tools/success-reels/${code}`).then(data => {
          if (data.analysisStatus === 'running') return
          patchReel(code, { analysisStatus: data.analysisStatus })
          setTracking(t => t[code] ? { ...t, [code]: { ...t[code], status: data.analysisStatus === 'ready' ? 'ready' : 'failed', error: data.analysisError } } : t)
          // Take the student straight to the result unless they are already looking at another reel.
          if (data.analysisStatus === 'ready' && !view.current.detail && !view.current.open) {
            setTracking(t => { const next = { ...t }; delete next[code]; return next })
            showDetail({ ...data, analysisStatus: 'ready' })
          }
        }).catch(() => {})
      }
    }, 4000)
    return () => clearInterval(timer)
  }, [running, patchReel, showDetail])

  async function toggleSave(reel) {
    const next = !reel.saved
    patchReel(reel.shortcode, { saved: next })
    try { await creatorRequest(`/creator-tools/success-reels/${reel.shortcode}/save`, { method: 'PUT', body: { saved: next } }) }
    catch { patchReel(reel.shortcode, { saved: !next }) }
  }

  const toasts = <div className="ct-rd-toasts" aria-live="polite">{Object.entries(tracking).map(([code, item]) =>
    <div key={code} className={`ct-rd-toast ct-rd-toast-${item.status}`}>
      {item.status === 'running' ? <LoaderCircle size={18} className="ct-rd-spin" /> : item.status === 'ready' ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
      <div><strong>{item.status === 'running' ? '분석 중…' : item.status === 'ready' ? '분석 완료' : '분석 실패'}</strong>
        <span>{item.status === 'failed' ? item.error || '잠시 후 다시 시도해주세요.' : `@${item.reel.username}${item.status === 'running' ? ' · 1~2분 걸려요' : ''}`}</span></div>
      {item.status === 'ready' && <button type="button" className="ct-rd-toast-go" onClick={() => { dismiss(code); showDetail({ ...item.reel, analysisStatus: 'ready' }) }}>결과 보기</button>}
      <button type="button" className="ct-rd-toast-x" aria-label="알림 닫기" onClick={() => dismiss(code)}><X size={15} /></button>
    </div>)}</div>

  if (detail) return <>
    <ReelDetail key={detail.shortcode} shortcode={detail.shortcode} preview={detail} initialTab={detail.tab} initialPlanId={detail.planId} onBack={closeDetail}
      onSaved={(code, saved) => patchReel(code, { saved })} onAnalyze={analyze} />
    {toasts}
  </>
  return <section className="ct-reels">
    <div className="ct-reels-intro">
      <p className="ct-muted">최근 3개월 안에 올라와 조회수 50만을 넘긴 개인 크리에이터의 릴스를 매일 모읍니다. 마음에 드는 릴스를 분석하고, 같은 공식으로 내 기획안을 만들어 보세요.</p>
      {lastUpdatedAt && <span className="ct-reels-updated">업데이트 {updatedAt(lastUpdatedAt)}</span>}
    </div>
    <form className="ct-reels-search" role="search" onSubmit={event => { event.preventDefault(); change({ q: draft.trim().slice(0, 40) }) }}>
      <Search size={18} aria-hidden="true" />
      <input type="search" value={draft} maxLength={40} onChange={event => { setDraft(event.target.value); if (!event.target.value && filters.q) change({ q: '' }) }}
        placeholder="키워드로 찾기 (예: 다이소, 여드름, 자취요리)" aria-label="성공 릴스 키워드 검색" />
      <button type="submit">검색</button>
    </form>
    <Chips label="분야" options={[['all', '전체'], ...categories.map(c => [c, c])]} value={filters.category} onChange={category => change({ category })} />
    <div className="ct-reels-filters">
      <Chips label="얼굴 노출" options={FACE} value={filters.face} onChange={face => change({ face })} />
      <Chips label="지역" options={REGION} value={filters.region} onChange={region => change({ region })} />
      <Chips label="정렬" options={SORT} value={filters.sort} onChange={sort => change({ sort })} />
      <div className="ct-reels-chips" role="group" aria-label="내 릴스">
        <button type="button" aria-pressed={filters.saved} onClick={() => change({ saved: !filters.saved, analyzed: false })}><Bookmark size={14} />저장한 릴스</button>
        <button type="button" aria-pressed={filters.analyzed} onClick={() => change({ analyzed: !filters.analyzed, saved: false })}><Sparkles size={14} />내가 분석한 릴스</button></div>
    </div>
    {error && <div role="alert" className="ct-error">{error}</div>}
    {!loading && !error && reels.length === 0 && <div className="ct-empty"><Play size={28} strokeWidth={1.4} /><strong>{filters.analyzed ? '아직 분석한 릴스가 없어요.' : filters.saved ? '저장한 릴스가 없어요.' : filters.q ? `'${filters.q}' 검색 결과가 없어요.` : '조건에 맞는 릴스가 아직 없어요.'}</strong><span className="ct-muted">{filters.analyzed ? '릴스에 마우스를 올려 분석하기를 눌러 보세요.' : filters.saved ? '릴스에 마우스를 올려 저장해 보세요.' : filters.q ? '다른 단어로 찾거나 분야 필터를 바꿔 보세요.' : '매일 새로 모으고 있어요.'}</span></div>}
    <div className="ct-reels-grid">
      {reels.map(reel => { const ready = reel.analysisStatus === 'ready', busy = reel.analysisStatus === 'running'
        return <article className="ct-reels-card" key={reel.shortcode}>
          <div className="ct-reels-thumb">
            <button type="button" className="ct-reels-open" onClick={() => ready ? showDetail(reel) : setOpen(reel)}
              aria-label={`@${reel.username} 릴스 ${ready ? '분석 보기' : '재생'}, 조회수 ${compactCount(reel.views)}`}>
              {reel.thumbnailUrl ? <img src={reel.thumbnailUrl} alt="" loading="lazy" /> : <span className="ct-reels-noimg" />}
            </button>
            <span className="ct-reels-date">{day(reel.postedAt)}</span>
            {reel.region === 'overseas' && <span className="ct-reels-region">해외</span>}
            {ready && <span className="ct-reels-analyzed"><Sparkles size={12} />분석됨</span>}
            <span className="ct-reels-views"><Play size={14} fill="currentColor" />{compactCount(reel.views)}</span>
            <div className="ct-reels-hover">
              <button type="button" className="ct-reels-analyze" disabled={busy} onClick={() => ready ? showDetail(reel) : analyze(reel)}>
                {busy ? <><LoaderCircle size={15} className="ct-rd-spin" />분석 중</> : ready ? '분석 보기' : '분석하기'}</button>
              <a className="ct-rd-icon" href={reel.permalink} target="_blank" rel="noreferrer" aria-label="인스타그램에서 열기" data-tip="인스타그램에서 열기"><InstagramIcon size={17} /></a>
              <button type="button" className="ct-rd-icon" aria-pressed={!!reel.saved} aria-label={reel.saved ? '저장 취소' : '저장하기'} data-tip={reel.saved ? '저장 취소' : '저장하기'} onClick={() => toggleSave(reel)}>
                {reel.saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}</button>
            </div>
          </div>
          <span className="ct-reels-caption"><strong>@{reel.username}</strong>{reel.captionKo || reel.caption}</span>
        </article> })}
    </div>
    {loading && <p role="status" className="ct-muted">불러오는 중…</p>}
    {hasMore && !loading && <button type="button" className="ct-reels-more" onClick={() => { setPage(p => p + 1); setLoading(true) }}>더 보기</button>}
    {open && <Player reel={open} onClose={() => setOpen(null)} onAnalyze={() => { const reel = open; setOpen(null); analyze(reel) }} />}
    {toasts}
  </section>
}
