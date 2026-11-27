import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Image as ImageIcon, Sparkles } from 'lucide-react'
import { drawSlide, prepare } from './render'
import { RATIOS, TEMPLATES } from './templates'

// 디자인 틀 고르기: every template drawn with the student's own words, so a design is picked by looking at it.
// Where a template wants a photo and the student has not placed one yet, an example photo stands in.
// The example photos are from Pixabay (free for commercial use; no people or brands): cafe by errordistrict666,
// room by karishea, path by ZbigniewMilewski, street by pierre9x6.
const SAMPLES = ['cafe', 'path', 'room', 'street'].map(name => `/studio-samples/${name}.webp`)
const sample = i => ({ src: SAMPLES[i % SAMPLES.length], x: 0.5, y: 0.5, zoom: 1 })
const THUMB_WIDTH = 360
// Most designs have a place for a photo; what a student needs to know first is whether one cannot do without.
const FILTERS = [['all', '전체', () => true], ['photo', '사진이 꼭 들어가는 디자인', t => t.imageRequired], ['text', '사진 없이도 되는 디자인', t => !t.imageRequired]]

// The look of one template on these slides: the student's colours, fonts and photos where they have them.
// offset: which example photo a template starts from, so the cards do not all show the same picture.
function lookOf(template, slides, view, offset = 0) {
  const entries = {}
  slides.forEach((slide, i) => {
    const mine = view?.slides?.[slide.id], slots = template.images[slide.role] || 0
    entries[slide.id] = { image: mine?.image || (slots > 0 ? sample(i + offset) : null), image2: mine?.image2 || (slots > 1 ? sample(i + offset + 1) : null) }
  })
  return { template: template.id, ratio: view?.ratio || '4:5', colors: view?.colors || {}, fonts: view?.fonts || {}, handle: view?.handle || '', profileImage: view?.profileImage || null,
    ...(view?.weightMix ? { weightMix: true } : {}), slides: entries }
}

// Thumbnails are drawn one after another at full size off screen and kept small: thirteen templates at 1,080px
// each would hold far more memory than the screen shows.
let queue = Promise.resolve()
function Thumb({ slide, index, total, design }) {
  const ref = useRef(null)
  const [w, h] = RATIOS[design.ratio] || RATIOS['4:5']
  useEffect(() => {
    let stale = false
    queue = queue.then(async () => {
      if (stale) return
      const assets = await prepare([slide], design)
      const canvas = ref.current
      if (stale || !canvas) return
      const full = document.createElement('canvas')
      drawSlide(full, { slide, index, total, design, assets })
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
    }).catch(() => {})
    return () => { stale = true }
  }, [slide, index, total, design])
  return <canvas ref={ref} width={THUMB_WIDTH} height={Math.round(THUMB_WIDTH * h / w)} style={{ aspectRatio: `${w} / ${h}` }} />
}

// compact: one row to scroll through (the design stage, where the slides below already show the result).
export default function TemplateGallery({ slides, value, recommended, view, onPick, compact = false }) {
  const [filter, setFilter] = useState('all')
  const cover = slides.find(s => s.role === 'cover') || slides[0], body = slides.find(s => s.role === 'body') || slides[1] || cover
  const shown = useMemo(() => compact ? [cover] : [cover, body], [compact, cover, body])
  // 훅ai's pick first, then the order of the list.
  const list = useMemo(() => [...TEMPLATES].sort((a, b) => (b.id === recommended) - (a.id === recommended)).filter(FILTERS.find(([id]) => id === filter)[2]), [recommended, filter])
  const looks = useMemo(() => Object.fromEntries(TEMPLATES.map((t, i) => [t.id, lookOf(t, shown, view, i)])), [shown, view])
  return <div className="st-stack" style={{ gap: 12 }}>
    {!compact && <div className="st-chips" role="tablist" aria-label="디자인 종류">{FILTERS.map(([id, name, fits]) => <button type="button" key={id} role="tab" aria-selected={filter === id} className="st-chip st-chip-soft" aria-pressed={filter === id} onClick={() => setFilter(id)}>{name} {TEMPLATES.filter(fits).length}</button>)}</div>}
    <div className={`st-tpl-grid${compact ? ' is-row' : ''}`}>{list.map(t => <button type="button" key={t.id} className="st-tpl" aria-pressed={t.id === value} title={t.name} onClick={() => t.id !== value && onPick(t.id)}>
      <span className="st-tpl-shots">{shown.map(slide => <Thumb key={slide.id} slide={slide} index={slides.indexOf(slide)} total={slides.length} design={looks[t.id]} />)}
        {t.id === value && <span className="st-tpl-check"><Check size={15} /></span>}
        {t.id === recommended && <span className="st-tpl-badge"><Sparkles size={12} />훅ai 추천</span>}</span>
      <span className="st-tpl-name"><strong>{t.name}</strong>{!compact && <span className="st-muted st-small">{t.imageRequired && <ImageIcon size={13} aria-label="사진이 꼭 들어가는 디자인" />}한 장 {t.limits.body.text}자</span>}</span>
    </button>)}</div>
  </div>
}
