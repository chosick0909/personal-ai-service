import { Scissors, MessageSquare, ArrowRight } from 'lucide-react'

export default function EditPage() {
  const tools = [
    ['컷편집·자막', '촬영한 영상을 올리면 훅·템포를 진단하고 컷과 자막을 편집해요.', '/creatorstudio?tab=media-analyze', Scissors],
    ['영상·캡션 피드백', '올리기 전에 영상과 캡션의 개선점을 확인해요.', '/creatorstudio?tab=feedback', MessageSquare],
  ]
  return <div className="st-stack" style={{ maxWidth: 860 }}>
    <div className="st-note">촬영을 마쳤다면 여기서 편집하고 점검해요. 지금은 예전 스튜디오의 도구로 연결돼요. 곧 기획안의 대본이 자막 초안으로 바로 넘어가요.</div>
    <div className="st-options">{tools.map(([title, desc, href, icon]) => { const Icon = icon; return <a key={title} className="st-option" href={href} style={{ textDecoration: 'none', color: 'inherit' }}><div className="st-option-top"><Icon size={22} style={{ color: 'var(--st-accent)' }} /><strong>{title}</strong><ArrowRight size={20} className="st-muted" /></div><span className="st-why">{desc}</span></a> })}</div>
  </div>
}
