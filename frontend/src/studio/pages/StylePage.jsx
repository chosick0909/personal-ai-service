import { useEffect, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { useStudio } from '../context'
import { studio } from '../api'

const CHOICES = [
  ['speech', '말투', ['존댓말', '반말', '섞어서']],
  ['energy', '분위기', ['차분하게', '텐션 높게', '담백하게']],
  ['persona', '나는', ['전문가', '옆집 언니·형', '친구', '선생님']],
  ['humor', '유머', ['자주', '가끔', '거의 안 함']],
  ['length', '문장', ['짧게 끊어서', '보통', '길게 설명']],
]

export default function StylePage() {
  const { toast } = useStudio()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ description: '', choices: {}, samples: '' })
  const [saving, setSaving] = useState(false)
  useEffect(() => { studio.style().then(d => { setData(d); if (d.style) setForm({ description: d.style.description || '', choices: d.style.choices || {}, samples: d.style.samples || '' }) }).catch(e => setError(e.message)) }, [])
  const save = async () => {
    setSaving(true)
    try { const r = await studio.saveStyle(form); setData(d => ({ ...d, style: r.style })); toast({ kind: 'ready', title: '내 말투를 저장했어요', body: r.style.card?.summary || '다음 기획안부터 이 말투로 써요.' }) }
    catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) } finally { setSaving(false) }
  }
  const removeTopic = async t => { setData(d => ({ ...d, topics: d.topics.filter(x => x.id !== t.id) })); try { await studio.removeTopic(t.id) } catch { /* ignore */ } }
  if (error) return <div className="st-error">{error}</div>
  if (!data) return <p className="st-muted">불러오는 중…</p>
  const card = data.style?.card
  return <div className="st-stack" style={{ maxWidth: 860 }}>
    <div className="st-note">비워 두면 훅ai가 알아서 써요. 적어두면 대본·캡션이 내 말투로 나와요. 훅ai가 정리한 '말투 카드'는 언제든 고칠 수 있어요.</div>
    {card && <section className="st-card st-stack" style={{ gap: 10, borderColor: 'var(--st-accent-soft-2)', background: 'var(--st-accent-soft)' }}><h3>훅ai가 정리한 내 말투 카드</h3><p style={{ fontSize: 17 }}>{card.summary}</p><div className="st-kv"><span>말투</span><div>{card.tone}</div></div><div className="st-kv"><span>문장</span><div>{card.sentence}</div></div>{card.signature?.length > 0 && <div className="st-kv"><span>자주 쓰는 표현</span><div className="st-chips">{card.signature.map(s => <span key={s} className="st-pill" style={{ background: '#fff' }}>{s}</span>)}</div></div>}{card.avoid?.length > 0 && <div className="st-kv"><span>안 쓰는 표현</span><div>{card.avoid.join(', ')}</div></div>}{card.ending && <div className="st-kv"><span>마무리 습관</span><div>{card.ending}</div></div>}</section>}
    <section className="st-card st-stack">
      <div className="st-field"><label>내 말투를 말로 설명하면 <small>예) 존댓말이고 짧게 끊어 말해요. 숫자로 근거를 대요. 끝은 질문으로 마무리해요.</small></label><textarea className="st-textarea" style={{ minHeight: 110 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      {CHOICES.map(([key, label, opts]) => <div className="st-field" key={key}><label>{label}</label><div className="st-chips">{opts.map(o => <button type="button" key={o} className="st-chip" aria-pressed={form.choices[key] === o} onClick={() => setForm(f => ({ ...f, choices: { ...f.choices, [key]: f.choices[key] === o ? '' : o } }))}>{o}</button>)}</div></div>)}
      <div className="st-field"><label>내가 쓰던 대본·캡션 붙여넣기 <small>잘 됐던 글 2~3개면 충분해요. 훅ai가 말투만 배우고 내용은 쓰지 않아요.</small></label><textarea className="st-textarea" value={form.samples} onChange={e => setForm(f => ({ ...f, samples: e.target.value }))} placeholder="여기에 붙여넣기" /></div>
      <button type="button" className="st-btn st-btn-primary st-btn-big" style={{ justifySelf: 'start' }} disabled={saving} onClick={save}><Save size={20} />{saving ? '훅ai가 정리하는 중…' : '내 말투 저장'}</button>
    </section>
    <section className="st-card st-stack" style={{ gap: 10 }}>
      <div><h3>훅ai가 기억하는 내 주제</h3><p className="st-muted">다른 기획안에서는 전체 내용이 아니라 주제만 기억해요. 지우면 더는 참고하지 않아요.</p></div>
      {data.topics.length === 0 ? <p className="st-muted">아직 없어요. 기획안의 주제를 정하면 여기에 쌓여요.</p>
        : <div className="st-chips">{data.topics.map(t => <span key={t.id} className="st-chip" style={{ cursor: 'default' }}>{t.topic}{t.category && <span className="st-muted">· {t.category}</span>}<button type="button" className="st-icon-btn" style={{ width: 28, height: 28, border: 0 }} aria-label="지우기" onClick={() => removeTopic(t)}><Trash2 size={14} /></button></span>)}</div>}
    </section>
  </div>
}
