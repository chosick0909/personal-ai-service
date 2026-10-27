import { useEffect, useRef, useState } from 'react'
import { Play, Search, LoaderCircle, Sparkles, X, Heart, MessageCircle, ScanSearch, CircleCheck, ChevronDown } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount, day, when } from '../api'

const FACE = [['any', '전체'], ['visible', '공개'], ['mixed', '일부'], ['hidden', '비공개']]
const REGION = [['any', '전체'], ['domestic', '국내'], ['overseas', '해외']]
const SORT = [['latest', '최신순'], ['views', '조회수순'], ['popular', '인기순']]
// Playback links are short-lived and the server resolves them one at a time, so a miss is retried on the next hover.
const playbackCache = new Map()
const playbackUrl = shortcode => {
  if (!playbackCache.has(shortcode)) playbackCache.set(shortcode, studio.playback(shortcode).then(d => d.media?.url || null).catch(() => null)
    .then(url => { if (!url) playbackCache.delete(shortcode); return url }))
  return playbackCache.get(shortcode)
}

export function InstagramIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></svg>
}
// A labeled group of 2–3 choices that sit together like one switch, so each filter reads as its own control.
export function Segmented({ label, options, value, onChange }) {
  return <div className="st-seg-group"><span className="st-filter-label">{label}</span>
    <div className="st-seg" role="group" aria-label={label}>{options.map(([id, text]) =>
      <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div></div>
}
export function Chips({ label, options, value, onChange, scroll }) {
  return <div className={`st-chips${scroll ? ' st-chips-scroll' : ''}`} role="group" aria-label={label}>{options.map(([id, text]) =>
    <button type="button" key={id} className="st-chip" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>
}

// Full-size player with sound; opens when the thumbnail is clicked.
export function PlayerModal({ reel, onClose, onAnalyze, onOpenAnalysis }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const close = useRef(null)
  useEffect(() => { let alive = true; close.current?.focus(); playbackUrl(reel.shortcode).then(u => { if (!alive) return; if (u) setUrl(u); else setFailed(true) }); return () => { alive = false } }, [reel.shortcode])
  useEffect(() => { const onKey = e => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [onClose])
  // The page behind stays put; only the caption column scrolls.
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous } }, [])
  const ready = reel.analysisStatus === 'ready', busy = reel.analysisStatus === 'running'
  return <div className="st-modal" role="dialog" aria-modal="true" aria-label={`@${reel.username} 영상`} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="st-player">
      <button ref={close} type="button" className="st-icon-btn st-player-close" aria-label="닫기" onClick={onClose}><X size={20} /></button>
      <div className="st-player-video">
        {url && !failed ? <video src={url} poster={reel.thumbnailUrl || undefined} controls autoPlay playsInline onError={() => setFailed(true)} />
          : <>{reel.thumbnailUrl && <img src={reel.thumbnailUrl} alt="" />}{failed ? <a className="st-video-link" href={reel.permalink} target="_blank" rel="noreferrer">인스타그램에서 보기</a> : <span className="st-video-link" style={{ background: 'rgba(0,0,0,.4)', color: '#fff' }}><LoaderCircle size={18} className="st-spin" /></span>}</>}
      </div>
      <div className="st-player-meta">
        <a href={`https://www.instagram.com/${reel.username}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 800, color: 'var(--st-text)', fontSize: 17 }}>@{reel.username}</a>
        <div className="st-row st-muted st-small" style={{ gap: 14 }}><span><Play size={14} /> {compactCount(reel.views)}</span><span><Heart size={14} /> {compactCount(reel.likes)}</span><span><MessageCircle size={14} /> {compactCount(reel.comments)}</span><span>{day(reel.postedAt)}</span></div>
        {/* Actions sit above the caption so a long caption never hides them. */}
        <div className="st-row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className={`st-btn ${ready ? 'st-btn-soft' : 'st-btn-primary'}`} disabled={busy} onClick={() => { onClose(); ready ? onOpenAnalysis() : onAnalyze() }}>
            {busy ? <><LoaderCircle size={18} className="st-spin" />분석 중</> : ready ? <><Sparkles size={18} />분석 보기</> : <><ScanSearch size={18} />분석하기</>}</button>
          <a className="st-btn" href={reel.permalink} target="_blank" rel="noreferrer"><InstagramIcon size={18} />인스타그램에서 보기</a>
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{reel.caption}</p>
        {reel.captionKo && reel.captionKo !== reel.caption && <p className="st-muted st-small" style={{ whiteSpace: 'pre-wrap' }}>번역: {reel.captionKo}</p>}
      </div>
    </div>
  </div>
}

// Hover: the reel plays muted in place and the action bar rises. Click: full player.
export function ReelCard({ reel, onPlay, onAnalyze, onOpenAnalysis, badge, children, footer, tour }) {
  const [preview, setPreview] = useState(null)
  const [hover, setHover] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [playing, setPlaying] = useState(false)
  const ready = reel.analysisStatus === 'ready', busy = reel.analysisStatus === 'running'
  useEffect(() => {
    if (!hover || preview || reel.source === 'upload-text') return undefined
    let alive = true
    const timer = setTimeout(() => { if (alive) setLoadingPreview(true) }, 0)
    playbackUrl(reel.shortcode).then(u => { if (!alive) return; setLoadingPreview(false); if (u) setPreview(u) })
    return () => { alive = false; clearTimeout(timer) }
  }, [hover, preview, reel.shortcode, reel.source])
  return <article className="st-reel" data-tour={tour}>
    <div className="st-reel-thumb" onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setPlaying(false) }}>
      <button type="button" className="st-reel-open" onClick={onPlay} aria-label={`@${reel.username} 영상 재생`}>
        {reel.thumbnailUrl ? <img src={reel.thumbnailUrl} alt="" loading="lazy" /> : <span className="st-reel-placeholder">{reel.source === 'upload-text' ? '📝' : '🎬'}<b>{reel.title || `@${reel.username}`}</b></span>}
        {hover && preview && <video src={preview} muted autoPlay loop playsInline className={`st-reel-preview${playing ? ' is-playing' : ''}`} onPlaying={() => setPlaying(true)} onEmptied={() => setPlaying(false)} />}
      </button>
      <span className="st-reel-date">{day(reel.postedAt)}</span>
      {hover && (loadingPreview || (preview && !playing)) && <span className="st-reel-loading"><LoaderCircle size={14} className="st-spin" /> 영상 불러오는 중</span>}
      <div className="st-reel-tags">{reel.recommended && <span className="st-reel-badge st-reel-rec">추천</span>}{badge !== undefined ? badge : ready ? <span className="st-reel-badge"><Sparkles size={12} /> 분석됨</span> : reel.region === 'overseas' ? <span className="st-reel-badge">해외</span> : null}</div>
      <div className="st-reel-stats"><span><Play size={14} fill="currentColor" />{compactCount(reel.views)}</span></div>
      <div className="st-reel-hover">
        <button type="button" className="st-reel-analyze" disabled={busy} onClick={ready ? onOpenAnalysis : onAnalyze}>
          {busy ? <><LoaderCircle size={16} className="st-spin" />분석 중</> : ready ? <><Sparkles size={16} />분석 보기</> : <><ScanSearch size={16} />분석하기</>}</button>
        {reel.permalink && <a className="st-reel-ig" href={reel.permalink} target="_blank" rel="noreferrer" aria-label="인스타그램에서 보기" data-tip="인스타그램에서 보기"><InstagramIcon size={18} /></a>}
        {footer}
      </div>
    </div>
    <span className="st-reel-caption"><strong>{reel.title || `@${reel.username}`}</strong>{reel.captionKo || reel.caption}</span>
    {children}
  </article>
}

// 지영's guide for students (2026-10-26), shown above the archive so every visit starts from how to read a reference.
const REFERENCE_STEPS = ['첫 3초는 어떻게 시작했는지', '어떤 스토리와 흐름으로 이어지는지', '왜 끝까지 보게 되는지', '내 주제라면 어떻게 응용할 수 있을지']
// Main copy first; the two guide topics stay folded to one line so the reels show without scrolling.
function ReferenceGuide() {
  const [open, setOpen] = useState(null)
  const toggle = id => setOpen(o => o === id ? null : id)
  return <section className="st-guide" aria-label="레퍼런스 활용 안내">
    <p className="st-reels-hero">레퍼런스는 정답지가 아니라<br /><em>내 아이디어를 꺼내기 위한 재료</em>입니다</p>
    <p className="st-reels-sub">많이 볼수록 ‘잘되는 콘텐츠의 감각’이 쌓이고, 그 감각이 결국 내 콘텐츠를 바꿔줍니다 ❤️‍🔥</p>
    <div className="st-guide-tabs">
      <button type="button" aria-expanded={open === 'what'} onClick={() => toggle('what')}>레퍼런스란?<ChevronDown size={18} /></button>
      <button type="button" aria-expanded={open === 'how'} onClick={() => toggle('how')}>레퍼런스를 어떻게 활용하나요?<ChevronDown size={18} /></button>
    </div>
    {open === 'what' && <div className="st-guide-panel">
      <p>조회수가 잘 나오거나 사람들이 오래 머무는 콘텐츠를 분석하기 위한 <b>‘좋은 예시’</b>입니다.</p>
      <p className="st-guide-note">따라 하는 것이 아니라, 잘되는 구조와 흐름을 배우기 위한 자료예요.</p>
    </div>}
    {open === 'how' && <div className="st-guide-panel">
      <p>그냥 보는 것으로 끝내지 마세요. 이렇게 생각하며 분석해 보세요.</p>
      <ul className="st-guide-steps">{REFERENCE_STEPS.map(step => <li key={step}><CircleCheck size={18} aria-hidden="true" />{step}</li>)}</ul>
      <p>주제는 내 것으로 바꾸고, 타깃도 내 고객으로 바꾸고, 내 경험이나 정보를 넣어보는 거예요.</p>
    </div>}
  </section>
}

export default function ReelsPage() {
  const { go, analyze, tracking, categories } = useStudio()
  const [filters, setFilters] = useState({ category: 'all', face: 'any', region: 'any', sort: 'latest', q: '', recommended: false })
  const [draft, setDraft] = useState('')
  const [reels, setReels] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ sort: filters.sort, page: String(page) })
    if (filters.category !== 'all') params.set('category', filters.category)
    if (filters.face !== 'any') params.set('face', filters.face)
    if (filters.region !== 'any') params.set('region', filters.region)
    if (filters.q) params.set('q', filters.q)
    if (filters.recommended) params.set('recommended', '1')
    studio.reels(params).then(data => { if (controller.signal.aborted) return; setReels(prev => page === 0 ? data.reels : [...prev, ...data.reels]); setHasMore(data.hasMore); if (page === 0 && data.lastUpdatedAt) setLastUpdatedAt(data.lastUpdatedAt) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, page])
  // Warm the first row's playback links one by one so hovering the top cards plays at once.
  useEffect(() => {
    let alive = true
    const warm = async () => { for (const reel of reels.slice(0, 6)) { if (!alive) return; await playbackUrl(reel.shortcode) } }
    const id = setTimeout(warm, 800)
    return () => { alive = false; clearTimeout(id) }
  }, [reels])
  const change = patch => { setFilters(f => ({ ...f, ...patch })); setPage(0); setLoading(true); setError('') }
  const shown = reels.map(r => tracking[r.shortcode] ? { ...r, analysisStatus: 'running' } : r)
  return <div className="st-stack">
    <ReferenceGuide />
    <div className="st-page-head st-reels-info"><p>최근 3개월 안에 올라와 조회수 50만을 넘긴 개인 크리에이터의 영상을 매일 모아요. 분석하면 '내 레퍼런스'에 자동으로 저장돼요.</p>{lastUpdatedAt && <span className="st-pill st-pill-gray">업데이트 {when(lastUpdatedAt)}</span>}</div>
    <form className="st-search" role="search" onSubmit={e => { e.preventDefault(); change({ q: draft.trim().slice(0, 40) }) }}>
      <Search size={20} className="st-muted" aria-hidden="true" />
      <input type="search" value={draft} maxLength={40} onChange={e => { setDraft(e.target.value); if (!e.target.value && filters.q) change({ q: '' }) }} placeholder="키워드로 찾기 (예: 다이소, 여드름, 자취요리)" aria-label="키워드 검색" />
      <button type="submit" className="st-btn st-btn-primary st-btn-sm">검색</button>
    </form>
    <section className="st-filter-panel" aria-label="필터">
      <div className="st-filter-row"><span className="st-filter-label">분야</span>
        <Chips label="분야" options={[['all', '전체'], ...categories.map(c => [c, c])]} value={filters.category} onChange={category => change({ category })} /></div>
      <div className="st-filter-row st-filter-groups">
        <Segmented label="보기" options={[['all', '전체'], ['recommended', '추천만']]} value={filters.recommended ? 'recommended' : 'all'} onChange={v => change({ recommended: v === 'recommended' })} />
        <Segmented label="정렬" options={SORT} value={filters.sort} onChange={sort => change({ sort })} />
        <Segmented label="얼굴" options={FACE} value={filters.face} onChange={face => change({ face })} />
        <Segmented label="지역" options={REGION} value={filters.region} onChange={region => change({ region })} />
      </div>
    </section>
    {error && <div className="st-error" role="alert">{error}</div>}
    {!loading && !error && reels.length === 0 && <div className="st-empty"><strong>{filters.q ? `'${filters.q}' 검색 결과가 없어요` : filters.recommended ? '추천 영상을 준비하고 있어요' : '조건에 맞는 영상이 아직 없어요'}</strong><span>매일 새로 모으고 있어요.</span></div>}
    <div className="st-reels">{shown.map((reel, i) => <ReelCard key={reel.shortcode} tour={i === 0 ? 'reel-card' : undefined} reel={reel} onPlay={() => setOpen(reel)} onAnalyze={() => analyze(reel)} onOpenAnalysis={() => go('reference', { ref: reel.shortcode })} />)}</div>
    {loading && <p className="st-muted" role="status">불러오는 중…</p>}
    {hasMore && !loading && <button type="button" className="st-btn st-btn-block" onClick={() => { setPage(p => p + 1); setLoading(true) }}>더 보기</button>}
    {open && <PlayerModal reel={shown.find(r => r.shortcode === open.shortcode) || open} onClose={() => setOpen(null)} onAnalyze={() => analyze(open)} onOpenAnalysis={() => go('reference', { ref: open.shortcode })} />}
  </div>
}
