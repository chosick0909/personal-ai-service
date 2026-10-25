import { useEffect, useState } from 'react'
import { Trash2, Sparkles, Check, ListOrdered, Clapperboard, PenLine, Quote } from 'lucide-react'
import { useStudio } from '../context'
import { studio } from '../api'
import { ReelCard, PlayerModal } from './ReelsPage'

const FILTERS = [['all', '전체'], ['hook', '첫 문장이 좋았던'], ['structure', '흐름이 좋았던'], ['filming', '촬영이 좋았던'], ['caption', '캡션이 좋았던']]
const LIKES = [['hook', '첫 문장이 좋아요', Quote], ['structure', '흐름이 좋아요', ListOrdered], ['filming', '촬영이 좋아요', Clapperboard], ['caption', '캡션이 좋아요', PenLine]]

export default function ReferencesPage() {
  const { go, toast } = useStudio()
  const [items, setItems] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
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
    <div className="st-page-head"><p>분석하기를 누른 릴스가 자동으로 모여요. 어떤 점이 좋았는지 표시해 두면 기획안 만들 때 바로 찾아 쓸 수 있어요.</p></div>
    <div className="st-chips" role="group" aria-label="참고 분류">{FILTERS.map(([id, label]) => <button type="button" key={id} className="st-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{id !== 'all' && <span className="st-muted">· {items.filter(r => r.tags.includes(id)).length}</span>}</button>)}</div>
    {shown.length === 0 && <div className="st-empty"><strong>{filter === 'all' ? '아직 분석한 릴스가 없어요' : '이 분류로 표시한 릴스가 없어요'}</strong><span>성공 릴스에서 마음에 드는 릴스의 '분석하기'를 눌러보세요. 분석한 릴스는 여기 자동으로 모여요.</span><button type="button" className="st-btn st-btn-primary" onClick={() => go('reels')}>성공 릴스 보러 가기</button></div>}
    <div className="st-reels">{shown.map(ref => { const reel = { shortcode: ref.id, username: ref.username, views: ref.views, postedAt: ref.postedAt, caption: ref.caption, permalink: `https://www.instagram.com/reel/${ref.id}/`, thumbnailUrl: ref.thumbnailUrl, analysisStatus: ref.analysisStatus, analysisRequests: ref.analysisRequests }
      return <ReelCard key={ref.id} reel={reel} badge={ref.format ? <span className="st-reel-badge">{ref.format}</span> : null} onPlay={() => setOpen(reel)} onAnalyze={() => go('reference', { ref: ref.id })} onOpenAnalysis={() => go('reference', { ref: ref.id })}
        footer={<button type="button" className="st-reel-ig" aria-label="내 레퍼런스에서 빼기" data-tip="내 레퍼런스에서 빼기" onClick={() => remove(ref)}><Trash2 size={17} /></button>}>
        <div className="st-ref-like"><span className="st-muted st-small">이 릴스에서 배울 점을 표시해 두세요</span>
          <div className="st-tags" role="group" aria-label="참고할 점">{LIKES.map(([tag, label, icon]) => { const Icon = icon; const on = ref.tags.includes(tag); return <button type="button" key={tag} className="st-tag" aria-pressed={on} onClick={() => toggleTag(ref, tag)}>{on ? <Check size={14} /> : <Icon size={14} />}{label}</button> })}</div></div>
        <button type="button" className="st-btn st-btn-soft st-btn-sm" onClick={() => go('new', { ref: ref.id })}><Sparkles size={16} />이 레퍼런스로 기획안 만들기</button>
      </ReelCard> })}</div>
    {open && <PlayerModal reel={open} onClose={() => setOpen(null)} onAnalyze={() => go('reference', { ref: open.shortcode })} onOpenAnalysis={() => go('reference', { ref: open.shortcode })} />}
  </div>
}
