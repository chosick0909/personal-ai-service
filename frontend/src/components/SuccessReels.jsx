import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Play, X, Heart, MessageCircle, Music2, Search } from 'lucide-react'
import { creatorRequest } from '../lib/creatorApi'
import './CreatorTools.css'

const FACE = [['any', '얼굴 전체'], ['visible', '얼굴 공개'], ['mixed', '얼굴 일부'], ['hidden', '얼굴 비공개']]
const REGION = [['any', '국내·해외'], ['domestic', '국내'], ['overseas', '해외']]
const SORT = [['latest', '최신순'], ['views', '조회수순']]

function compactCount(value) {
  if (!Number.isFinite(value)) return '-'
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만`
  return value.toLocaleString('ko-KR')
}
const day = value => value ? new Date(value).toISOString().slice(0, 10) : ''

function Chips({ label, options, value, onChange }) {
  return <div className="ct-reels-chips" role="group" aria-label={label}>{options.map(([id, text]) =>
    <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>
}

function Player({ reel, onClose }) {
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
        <a className="ct-reels-origin" href={reel.permalink} target="_blank" rel="noreferrer">인스타그램 원문 열기 <ExternalLink size={14} /></a>
      </div>
    </div>
  </div>
}

export default function SuccessReels({ categories = [] }) {
  const [filters, setFilters] = useState({ category: 'all', face: 'any', region: 'any', sort: 'latest', q: '' })
  const [draft, setDraft] = useState('')
  const [reels, setReels] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
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
    creatorRequest(`/creator-tools/success-reels?${params}`, { signal: controller.signal })
      .then(data => { setReels(previous => page === 0 ? data.reels : [...previous, ...data.reels]); setHasMore(data.hasMore) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, page])
  const change = patch => { setFilters(previous => ({ ...previous, ...patch })); setPage(0); setLoading(true); setError('') }
  return <section className="ct-reels">
    <p className="ct-muted">최근 3개월 안에 올라와 조회수 50만을 넘긴 개인 크리에이터의 릴스를 매일 모읍니다. 집·일상에서 따라 만들 수 있는 계정만 골랐어요.</p>
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
    </div>
    {error && <div role="alert" className="ct-error">{error}</div>}
    {!loading && !error && reels.length === 0 && <div className="ct-empty"><Play size={28} strokeWidth={1.4} /><strong>{filters.q ? `'${filters.q}' 검색 결과가 없어요.` : '조건에 맞는 릴스가 아직 없어요.'}</strong><span className="ct-muted">{filters.q ? '다른 단어로 찾거나 분야 필터를 바꿔 보세요.' : '매일 새로 모으고 있어요.'}</span></div>}
    <div className="ct-reels-grid">
      {reels.map(reel => <button type="button" className="ct-reels-card" key={reel.shortcode} onClick={() => setOpen(reel)} aria-label={`@${reel.username} 릴스 재생, 조회수 ${compactCount(reel.views)}`}>
        <div className="ct-reels-thumb">
          {reel.thumbnailUrl ? <img src={reel.thumbnailUrl} alt="" loading="lazy" /> : <span className="ct-reels-noimg" />}
          <span className="ct-reels-date">{day(reel.postedAt)}</span>
          {reel.region === 'overseas' && <span className="ct-reels-region">해외</span>}
          <span className="ct-reels-views"><Play size={14} fill="currentColor" />{compactCount(reel.views)}</span>
        </div>
        <span className="ct-reels-caption"><strong>@{reel.username}</strong>{reel.captionKo || reel.caption}</span>
      </button>)}
    </div>
    {loading && <p role="status" className="ct-muted">불러오는 중…</p>}
    {hasMore && !loading && <button type="button" className="ct-reels-more" onClick={() => { setPage(p => p + 1); setLoading(true) }}>더 보기</button>}
    {open && <Player reel={open} onClose={() => setOpen(null)} />}
  </section>
}
