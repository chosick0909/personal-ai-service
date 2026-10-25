import { useEffect, useState } from 'react'
import { Printer, ArrowLeft } from 'lucide-react'
import { useStudio } from '../context'
import { studio, SLOT_LABELS } from '../api'

const chosenOf = f => f ? (f.custom ? { text: f.custom } : f.options?.[f.chosen ?? 0]) : null

export default function PrintView({ sessionId }) {
  const { go } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { studio.session(sessionId).then(setData).catch(e => setError(e.message)) }, [sessionId])
  if (error) return <div className="st-content"><div className="st-error">{error}</div></div>
  if (!data) return <div className="st-content"><p className="st-muted">불러오는 중…</p></div>
  const s = data.session
  const thumb = chosenOf(s.thumbnail), hook = chosenOf(s.hook), lines = s.script?.edited || chosenOf(s.script)?.lines || [], cap = s.caption?.edited || chosenOf(s.caption)
  return <div className="st-content" style={{ maxWidth: 900 }}>
    <div className="st-row st-no-print" style={{ justifyContent: 'space-between', marginBottom: 16 }}><button type="button" className="st-btn st-btn-ghost" onClick={() => go('plan', { session: s.id })}><ArrowLeft size={20} />기획안으로</button><button type="button" className="st-btn st-btn-primary st-btn-big" onClick={() => window.print()}><Printer size={20} />인쇄 · PDF로 저장</button></div>
    <p className="st-muted st-small st-no-print" style={{ marginBottom: 16 }}>인쇄 창에서 '대상'을 'PDF로 저장'으로 고르면 파일로 받을 수 있어요. 휴대폰은 공유 → 'PDF로 저장'.</p>
    <article className="st-print" style={{ border: '1px solid var(--st-line)', borderRadius: 16 }}>
      <header><span className="st-muted st-small">HookAI 기획안 · {new Date(s.updatedAt).toLocaleDateString('ko-KR')}</span><h1>{s.title || s.topic?.title}</h1>{s.topic?.promise && <p className="st-muted">{s.topic.promise}</p>}
        {data.sources && Object.keys(data.sources).length > 0 && <p className="st-small st-muted">참고: {Object.entries(data.sources).map(([slot, src]) => `${SLOT_LABELS[slot]} ${src.label}`).join(' · ')}</p>}</header>
      {thumb && <section><h2>썸네일 카피</h2><p style={{ fontSize: 22, fontWeight: 800 }}>{thumb.text}</p></section>}
      {hook && <section><h2>첫 문장</h2><p style={{ fontSize: 18, fontWeight: 700 }}>“{hook.spoken || hook.text}”</p>{hook.onScreen && <p className="st-small st-muted">화면 자막: {hook.onScreen}</p>}</section>}
      {lines.length > 0 && <section><h2>대본 <span className="st-small st-muted">약 {lines.reduce((a, l) => a + l.seconds, 0)}초</span></h2><table><tbody>{lines.map((l, i) => <tr key={i}><th style={{ width: 60 }}><span className="st-muted" style={{ fontWeight: 400 }}>{l.seconds}초</span></th><td>{l.spoken}{l.onScreen && <div className="st-small st-muted">자막: {l.onScreen}</div>}</td></tr>)}</tbody></table></section>}
      {s.filming && <section><h2>촬영·편집</h2><table><thead><tr><th>#</th><th>초</th><th>구도</th><th>행동</th><th>자막</th><th>대사</th></tr></thead><tbody>{s.filming.storyboard.map(b => <tr key={b.scene}><td>{b.scene}</td><td>{b.seconds}</td><td>{b.shot}</td><td>{b.action}</td><td>{b.onScreen}</td><td>{b.spoken}</td></tr>)}</tbody></table>
        <table style={{ marginTop: 12 }}><tbody><tr><th style={{ width: 90 }}>장소</th><td>{s.filming.location}</td></tr><tr><th>준비물</th><td>{(s.filming.props || []).join(', ')}</td></tr><tr><th>카메라</th><td>{s.filming.camera}</td></tr><tr><th>조명</th><td>{s.filming.lighting}</td></tr><tr><th>편집</th><td>{s.filming.editing}</td></tr>{s.filming.checklist?.length > 0 && <tr><th>체크</th><td>{s.filming.checklist.map((c, i) => <div key={i}>☐ {c}</div>)}</td></tr>}{s.filming.editingPlan && <><tr><th>자막</th><td>{s.filming.editingPlan.subtitleStyle}</td></tr><tr><th>컷·템포</th><td>{s.filming.editingPlan.cuts}</td></tr><tr><th>전환·효과</th><td>{[s.filming.editingPlan.transitions, s.filming.editingPlan.effects].filter(Boolean).join(' / ')}</td></tr><tr><th>사운드</th><td>{s.filming.editingPlan.sound}</td></tr></>}{s.memo && <tr><th>메모</th><td style={{ whiteSpace: 'pre-wrap' }}>{s.memo}</td></tr>}</tbody></table></section>}
      {cap && <section><h2>캡션</h2><p style={{ whiteSpace: 'pre-wrap' }}>{cap.text}</p><p className="st-muted">{(cap.hashtags || []).map(t => `#${t}`).join(' ')}</p></section>}
      {s.placeholders?.length > 0 && <section><h2>촬영 전에 채울 빈칸</h2><p>{s.placeholders.join(' · ')}</p></section>}
    </article>
  </div>
}
