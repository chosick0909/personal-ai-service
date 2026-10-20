import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'
import { referenceReels } from '../lib/referenceReels'
import { referenceContentHref } from '../lib/referenceContentLink'

function Reel({ media, username, index }) {
  const container = useRef(null)
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('loading')
  useEffect(() => {
    if (!window.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '200px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible || status !== 'loading') return
    const timer = setTimeout(() => setStatus('delayed'), 15000)
    return () => clearTimeout(timer)
  }, [visible, status])
  return <article className="ct-reel-card" ref={container}>
    <div className="ct-reel-frame">
      {visible && <iframe src={media.embedUrl} title={`@${username} 릴스 ${index + 1}`}
        loading="lazy" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setStatus('loaded')} onError={() => setStatus('delayed')} />}
      {status === 'loading' && <div className="ct-reel-loading" role="status"><Play size={28} /><span>{visible ? '릴스 불러오는 중…' : '릴스 미리보기'}</span></div>}
    </div>
    <div className="ct-reel-footer">
      {media.caption && <p className="ct-reel-caption">{media.caption}</p>}
      <div><span>{media.views !== null ? `조회 ${media.views.toLocaleString('ko-KR')}회 · 수집 시점` : `릴스 ${index + 1}`}</span>
        <a href={media.href} target="_blank" rel="noopener noreferrer" aria-label={`@${username} 릴스 ${index + 1} Instagram에서 열기`}>원문 열기 <ExternalLink size={13} /></a></div>
      {status === 'delayed' && <p className="ct-reel-help">불러오기가 지연되고 있어요. 원문 열기로도 확인할 수 있습니다.</p>}
    </div>
  </article>
}

export default function ReferenceReels({ account }) {
  const reels = referenceReels(account)
  const viralHref = referenceContentHref(account.viralMedia?.permalink)
  if (!reels.length) return null
  return <section className="ct-reel-section" aria-label={`@${account.username} 참고 릴스`}>
    <div className="ct-reel-heading"><h3>릴스로 먼저 살펴보기</h3><span>영상을 눌러 여기서 재생하세요</span></div>
    <div className="ct-reel-grid">{reels.map((media, index) => <Reel key={media.href} media={media} username={account.username} index={index} />)}</div>
    {viralHref && !reels.some(media => media.href === viralHref) && <a className="ct-reel-viral" href={viralHref} target="_blank" rel="noopener noreferrer">50만+ 조회 콘텐츠도 살펴보기 <ExternalLink size={13} /></a>}
    <p className="ct-reel-help">게시자의 공개·퍼가기 설정이나 Instagram 로그인 상태에 따라 재생이 제한될 수 있습니다. 재생되지 않으면 원문 열기를 눌러주세요.</p>
  </section>
}
