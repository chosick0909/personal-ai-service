import { estimateLineSeconds } from '../../lib/scriptText'
import { useEffect, useState } from 'react'
import { Printer, ArrowLeft } from 'lucide-react'
import { useStudio } from '../context'
import { studio } from '../api'

const chosenOf = f => f ? (f.custom ? { text: f.custom } : f.options?.[f.chosen ?? 0]) : null

// The finished plan as a clean A4 document with only what is needed to shoot and post: cover copy, first line,
// script, shooting setup, storyboard and caption. The sheet is a table whose empty head and foot repeat on every
// printed page, which gives each page its margins while the page itself has none (so the browser adds no header).
function Section({ n, title, extra, children }) {
  return <section className="pp-section"><h2><b>{n}</b>{title}{extra && <span>{extra}</span>}</h2>{children}</section>
}

export default function PrintView({ sessionId }) {
  const { go } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { studio.session(sessionId).then(setData).catch(e => setError(e.message)) }, [sessionId])
  if (error) return <div className="st-content"><div className="st-error">{error}</div></div>
  if (!data) return <div className="st-content"><p className="st-muted">불러오는 중…</p></div>
  const s = data.session
  const thumb = chosenOf(s.thumbnail), hook = chosenOf(s.hook), lines = s.script?.edited || chosenOf(s.script)?.lines || [], cap = s.caption?.edited || chosenOf(s.caption)
  const total = lines.reduce((a, l) => a + estimateLineSeconds(l.spoken), 0)
  const f = s.filming
  const setting = f ? [['장소', f.location], ['카메라', f.camera], ['조명', f.lighting]].filter(([, v]) => v) : []
  let n = 0
  const next = () => ++n
  return <div className="st-content pp-wrap">
    <div className="st-row st-no-print" style={{ justifyContent: 'space-between', marginBottom: 12 }}><button type="button" className="st-btn st-btn-ghost" onClick={() => go('plan', { session: s.id })}><ArrowLeft size={20} />기획안으로</button><button type="button" className="st-btn st-btn-primary st-btn-big" onClick={() => window.print()}><Printer size={20} />인쇄 · PDF로 저장</button></div>
    <p className="st-muted st-small st-no-print" style={{ marginBottom: 16 }}>인쇄 창에서 '대상'을 'PDF로 저장'으로 고르면 파일로 받을 수 있어요. 휴대폰은 공유 → 'PDF로 저장'.</p>
    <table className="pp-sheet"><thead><tr><td><div className="pp-gap" /></td></tr></thead><tfoot><tr><td><div className="pp-gap" /></td></tr></tfoot><tbody><tr><td>
      <article className="pp">
        <header className="pp-cover">
          <div className="pp-brand"><span>HookAI 기획안</span><span>{new Date(s.updatedAt).toLocaleDateString('ko-KR')}{total > 0 ? ` · 약 ${total}초` : ''}</span></div>
          <h1>{s.title || s.topic?.title}</h1>
          {s.topic?.promise && <p className="pp-promise">{s.topic.promise}</p>}
        </header>

        {thumb && <Section n={next()} title="썸네일 카피"><div className="pp-thumb">{thumb.text}</div></Section>}

        {hook && <Section n={next()} title="첫 문장"><blockquote className="pp-hook">“{hook.spoken || hook.text}”</blockquote>{hook.onScreen && <p className="pp-onscreen"><i>자막</i>{hook.onScreen}</p>}</Section>}

        {lines.length > 0 && <Section n={next()} title="대본" extra={`약 ${total}초`}>
          <ol className="pp-script">{lines.map((l, i) => <li key={i}>
            <span className="pp-sec">{estimateLineSeconds(l.spoken)}초</span>
            <div><p>{l.spoken}</p>{l.onScreen && <p className="pp-onscreen"><i>자막</i>{l.onScreen}</p>}</div>
          </li>)}</ol>
        </Section>}

        {f && (setting.length > 0 || f.props?.length > 0) && <Section n={next()} title="촬영 세팅">
          <dl className="pp-facts">{setting.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            {f.props?.length > 0 && <div><dt>준비물</dt><dd>{f.props.join(', ')}</dd></div>}</dl>
        </Section>}

        {f?.storyboard?.length > 0 && <Section n={next()} title="스토리보드" extra={`${f.storyboard.length}컷`}>
          <ol className="pp-board">{f.storyboard.map(b => <li key={b.scene}>
            <span className="pp-sec">#{b.scene}{b.seconds ? ` · ${b.seconds}초` : ''}</span>
            <div><strong>{b.shot}</strong>{b.action && <p>{b.action}</p>}</div>
          </li>)}</ol>
        </Section>}

        {cap && <Section n={next()} title="캡션"><div className="pp-caption"><p>{cap.text}</p>{cap.hashtags?.length > 0 && <p className="pp-tags">{cap.hashtags.map(t => `#${t}`).join(' ')}</p>}</div></Section>}

        {s.placeholders?.length > 0 && <Section n={next()} title="촬영 전에 채울 빈칸"><p>{s.placeholders.join(' · ')}</p></Section>}
        {s.memo && <Section n={next()} title="내 메모"><p className="pp-memo">{s.memo}</p></Section>}
      </article>
    </td></tr></tbody></table>
  </div>
}
