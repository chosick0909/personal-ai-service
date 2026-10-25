import { useEffect, useState } from 'react'
import { Trash2, Play, Sparkles } from 'lucide-react'
import { useStudio } from '../context'
import { studio, compactCount, day, SLOT_LABELS } from '../api'
import { InstagramIcon } from './ReelsPage'

const FILTERS = [['all', '전체'], ['hook', '첫 문장 참고'], ['structure', '전개 참고'], ['filming', '촬영·편집 참고'], ['caption', '캡션 참고']]

export default function ReferencesPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  useEffect(() => { studio.references().then(d => setItems(d.references)).catch(e => setError(e.message)) }, [])
  const toggleTag = async (ref, tag) => {
    const tags = ref.tags.includes(tag) ? ref.tags.filter(t => t !== tag) : [...ref.tags, tag]
    setItems(list => list.map(r => r.id === ref.id ? { ...r, tags } : r))
    try { await studio.tagReference(ref.id, tags) } catch (e) { toast({ kind: 'failed', title: '저장 실패', body: e.message }) }
  }
  const remove = async ref => {
    if (!window.confirm(`@${ref.username} 릴스를 내 레퍼런스에서 뺄까요? 분석 결과는 남아 있어 언제든 다시 분석할 수 있어요.`)) return
    setItems(list => list.filter(r => r.id !== ref.id))
    try { await studio.removeReference(ref.id) } catch (e) { toast({ kind: 'failed', title: '삭제 실패', body: e.message }) }
  }
  if (error) return <div className="st-error">{error}</div>
  if (!items) return <p className="st-muted">불러오는 중…</p>
  const shown = filter === 'all' ? items : items.filter(r => r.tags.includes(filter))
  return <div className="st-stack">
    <div className="st-page-head"><p>분석하기를 누른 릴스가 자동으로 모여요. 어디에 참고할지 표시해 두면 기획안 만들 때 바로 찾아요.</p></div>
    <div className="st-chips" role="group" aria-label="참고 분류">{FILTERS.map(([id, label]) => <button type="button" key={id} className="st-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{id !== 'all' && <span className="st-muted">· {items.filter(r => r.tags.includes(id)).length}</span>}</button>)}</div>
    {shown.length === 0 && <div className="st-empty"><strong>{filter === 'all' ? '아직 분석한 릴스가 없어요' : '이 분류로 표시한 릴스가 없어요'}</strong><span>성공 릴스에서 마음에 드는 릴스의 '분석하기'를 눌러보세요.</span><button type="button" className="st-btn st-btn-primary" onClick={() => go('reels')}>성공 릴스 보러 가기</button></div>}
    <div className="st-reels">{shown.map(ref => <article className="st-reel" key={ref.id}>
      <div className="st-reel-thumb">
        <button type="button" className="st-reel-open" onClick={() => go('reference', { ref: ref.id })} aria-label={`@${ref.username} 분석 보기`}>{ref.thumbnailUrl && <img src={ref.thumbnailUrl} alt="" loading="lazy" />}</button>
        <span className="st-reel-date">{day(ref.postedAt)}</span>
        {ref.format && <span className="st-reel-badge">{ref.format}</span>}
        <div className="st-reel-stats"><span><Play size={14} fill="currentColor" />{compactCount(ref.views)}</span></div>
      </div>
      <span className="st-reel-caption"><strong>@{ref.username}</strong>{ref.summary || ref.caption}</span>
      <div className="st-tags" role="group" aria-label="참고 분류">{Object.entries(SLOT_LABELS).map(([tag, label]) => <button type="button" key={tag} className="st-tag" aria-pressed={ref.tags.includes(tag)} onClick={() => toggleTag(ref, tag)}>{label}</button>)}</div>
      <div className="st-reel-actions" style={{ gridTemplateColumns: 'minmax(0,1fr) 44px 44px' }}>
        <button type="button" className="st-btn st-btn-soft st-btn-sm" onClick={() => go('new', { ref: ref.id })}><Sparkles size={16} />기획안 만들기</button>
        <a className="st-icon-btn" href={`https://www.instagram.com/reel/${ref.id}/`} target="_blank" rel="noreferrer" aria-label="인스타그램에서 보기" title="인스타그램에서 보기"><InstagramIcon size={18} /></a>
        <button type="button" className="st-icon-btn" aria-label="내 레퍼런스에서 빼기" title="내 레퍼런스에서 빼기" onClick={() => remove(ref)}><Trash2 size={18} /></button>
      </div>
    </article>)}</div>
  </div>
}
