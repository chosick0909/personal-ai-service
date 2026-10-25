import { useEffect, useState } from 'react'
import { Play, Search, LoaderCircle, Sparkles } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount, day, when } from '../api'

const FACE = [['any', '얼굴 전체'], ['visible', '얼굴 공개'], ['mixed', '얼굴 일부'], ['hidden', '얼굴 비공개']]
const REGION = [['any', '국내·해외'], ['domestic', '국내'], ['overseas', '해외']]
const SORT = [['latest', '최신순'], ['views', '조회수순'], ['popular', '인기순']]

export function InstagramIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></svg>
}
export function Chips({ label, options, value, onChange, scroll }) {
  return <div className={`st-chips${scroll ? ' st-chips-scroll' : ''}`} role="group" aria-label={label}>{options.map(([id, text]) =>
    <button type="button" key={id} className="st-chip" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}</div>
}

export function ReelCard({ reel, onOpen, onAnalyze, extra }) {
  const ready = reel.analysisStatus === 'ready', busy = reel.analysisStatus === 'running'
  return <article className="st-reel">
    <div className="st-reel-thumb">
      <button type="button" className="st-reel-open" onClick={onOpen} aria-label={`@${reel.username} 릴스 ${ready ? '분석 보기' : '분석하기'}`}>
        {reel.thumbnailUrl ? <img src={reel.thumbnailUrl} alt="" loading="lazy" /> : null}
      </button>
      <span className="st-reel-date">{day(reel.postedAt)}</span>
      {ready ? <span className="st-reel-badge"><Sparkles size={12} /> 분석됨</span> : reel.region === 'overseas' ? <span className="st-reel-badge">해외</span> : null}
      <div className="st-reel-stats"><span><Play size={14} fill="currentColor" />{compactCount(reel.views)}</span>{reel.analysisRequests > 0 && <span>🔍 {reel.analysisRequests}명 분석</span>}</div>
    </div>
    <div className="st-reel-actions">
      <button type="button" className={`st-btn ${ready ? 'st-btn-soft' : 'st-btn-primary'}`} disabled={busy} onClick={ready ? onOpen : onAnalyze}>
        {busy ? <><LoaderCircle size={18} className="st-spin" />분석 중</> : ready ? '분석 보기' : '분석하기'}</button>
      <a className="st-icon-btn" href={reel.permalink} target="_blank" rel="noreferrer" aria-label="인스타그램에서 보기" title="인스타그램에서 보기" style={{ width: 48, height: 48 }}><InstagramIcon /></a>
    </div>
    <span className="st-reel-caption"><strong>@{reel.username}</strong>{reel.captionKo || reel.caption}</span>
    {extra}
  </article>
}

export default function ReelsPage() {
  const { go, analyze, tracking, categories } = useStudio()
  const [filters, setFilters] = useState({ category: 'all', face: 'any', region: 'any', sort: 'latest', q: '' })
  const [draft, setDraft] = useState('')
  const [reels, setReels] = useState([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ sort: filters.sort, page: String(page) })
    if (filters.category !== 'all') params.set('category', filters.category)
    if (filters.face !== 'any') params.set('face', filters.face)
    if (filters.region !== 'any') params.set('region', filters.region)
    if (filters.q) params.set('q', filters.q)
    studio.reels(params).then(data => { if (controller.signal.aborted) return; setReels(prev => page === 0 ? data.reels : [...prev, ...data.reels]); setHasMore(data.hasMore); if (page === 0 && data.lastUpdatedAt) setLastUpdatedAt(data.lastUpdatedAt) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [filters, page])
  const change = patch => { setFilters(f => ({ ...f, ...patch })); setPage(0); setLoading(true); setError('') }
  const shown = reels.map(r => tracking[r.shortcode] ? { ...r, analysisStatus: 'running' } : r)
  return <div className="st-stack">
    <div className="st-page-head"><p>최근 3개월 안에 올라와 조회수 50만을 넘긴 개인 크리에이터의 릴스를 매일 모아요. 분석하면 '내 레퍼런스'에 자동으로 저장돼요.</p>{lastUpdatedAt && <span className="st-pill st-pill-gray">업데이트 {when(lastUpdatedAt)}</span>}</div>
    <form className="st-search" role="search" onSubmit={e => { e.preventDefault(); change({ q: draft.trim().slice(0, 40) }) }}>
      <Search size={20} className="st-muted" aria-hidden="true" />
      <input type="search" value={draft} maxLength={40} onChange={e => { setDraft(e.target.value); if (!e.target.value && filters.q) change({ q: '' }) }} placeholder="키워드로 찾기 (예: 다이소, 여드름, 자취요리)" aria-label="키워드 검색" />
      <button type="submit" className="st-btn st-btn-primary st-btn-sm">검색</button>
    </form>
    <Chips label="분야" scroll options={[['all', '전체'], ...categories.map(c => [c, c])]} value={filters.category} onChange={category => change({ category })} />
    <div className="st-row" style={{ gap: '8px 20px' }}>
      <Chips label="정렬" options={SORT} value={filters.sort} onChange={sort => change({ sort })} />
      <Chips label="얼굴" options={FACE} value={filters.face} onChange={face => change({ face })} />
      <Chips label="지역" options={REGION} value={filters.region} onChange={region => change({ region })} />
    </div>
    {error && <div className="st-error" role="alert">{error}</div>}
    {!loading && !error && reels.length === 0 && <div className="st-empty"><strong>{filters.q ? `'${filters.q}' 검색 결과가 없어요` : '조건에 맞는 릴스가 아직 없어요'}</strong><span>매일 새로 모으고 있어요.</span></div>}
    <div className="st-reels">{shown.map(reel => <ReelCard key={reel.shortcode} reel={reel} onOpen={() => reel.analysisStatus === 'ready' ? go('reference', { ref: reel.shortcode }) : analyze(reel)} onAnalyze={() => analyze(reel)} />)}</div>
    {loading && <p className="st-muted" role="status">불러오는 중…</p>}
    {hasMore && !loading && <button type="button" className="st-btn st-btn-block" onClick={() => { setPage(p => p + 1); setLoading(true) }}>더 보기</button>}
  </div>
}
