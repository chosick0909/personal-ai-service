import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'
import { referenceReels } from '../lib/referenceReels'
import { creatorRequest } from '../lib/creatorApi'

// Bound metadata lookups across all account cards, including offscreen cards.
let active = 0
const queue = []
function lookup(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject })
    drain()
  })
}
function drain() {
  while (active < 2 && queue.length) {
    const item = queue.shift()
    active++
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => { active--; drain() })
  }
}

function Reel({ media, username, index, onFailed }) {
  const video = useRef(null)
  const [ready, setReady] = useState(false)
  const fail = useCallback(() => onFailed(media.href), [onFailed, media.href])
  useEffect(() => {
    const timer = setTimeout(fail, 12000)
    const element = video.current
    const loaded = () => { clearTimeout(timer); setReady(true) }
    element.addEventListener('loadeddata', loaded)
    return () => { clearTimeout(timer); element.removeEventListener('loadeddata', loaded) }
  }, [fail])
  useEffect(() => {
    if (!ready) return
    const element = video.current
    if (!window.IntersectionObserver) { element.play().catch(() => {}); return () => element.pause() }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) element.play().catch(() => {})
      else element.pause()
    }, { threshold: 0.5 })
    observer.observe(element)
    return () => { observer.disconnect(); element.pause() }
  }, [ready])
  return <article className="ct-reel-card" hidden={!ready}>
    <div className="ct-reel-frame">
      <video ref={video} src={media.url} controls muted loop playsInline preload="auto"
        aria-label={`@${username} 릴스 ${index + 1}`} onError={fail} />
    </div>
    <div className="ct-reel-footer"><div>
      <span>{media.views !== null ? `조회 ${media.views.toLocaleString('ko-KR')}회 · 수집 시점` : `릴스 ${index + 1}`}</span>
      <a href={media.href} target="_blank" rel="noopener noreferrer">원문 열기 <ExternalLink size={13} /></a>
    </div></div>
  </article>
}

export default function ReferenceReels({ account }) {
  const identity = JSON.stringify([account.username, referenceReels(account)])
  return <ReferenceReelList key={identity} account={account} identity={identity} />
}

function ReferenceReelList({ account, identity }) {
  const container = useRef(null)
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !window.IntersectionObserver)
  const [results, setResults] = useState([])
  const [pending, setPending] = useState(true)
  const key = identity
  useEffect(() => {
    if (!window.IntersectionObserver) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '100px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    const [username, reels] = JSON.parse(key)
    Promise.all(reels.map(media => lookup(async () => {
      if (controller.signal.aborted) return
      try {
        const result = await creatorRequest('/discovery/reference-playback', {
          method: 'POST', body: { username, permalink: media.href }, signal: controller.signal,
        })
        if (!controller.signal.aborted && result.media?.url) setResults(previous => [...previous, { ...media, url: result.media.url }])
      } catch { /* Unavailable media is omitted, never replaced by a post embed. */ }
    }))).finally(() => { if (!controller.signal.aborted) setPending(false) })
    return () => controller.abort()
  }, [visible, key])
  const failed = useCallback(href => setResults(previous => previous.filter(item => item.href !== href)), [])
  if (!pending && !results.length) return null
  return <section ref={container} className="ct-reel-section" aria-label={`@${account.username} 참고 릴스`}>
    {(pending || results.length > 0) && <div className="ct-reel-heading"><h3>릴스로 먼저 살펴보기</h3><span>화면 안에서 재생 · 소리는 플레이어에서 켜주세요</span></div>}
    {pending && <p className="ct-reel-pending" role="status"><Play size={16} /> 재생 가능한 릴스 확인 중…</p>}
    <div className="ct-reel-grid">{results.map((media, index) => <Reel key={media.href} media={media} username={account.username} index={index} onFailed={failed} />)}</div>
  </section>
}
