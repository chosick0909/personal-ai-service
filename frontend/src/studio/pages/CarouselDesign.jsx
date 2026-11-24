import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, ImagePlus, LoaderCircle, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { useStudio } from '../context'
import { studio, generateImage, uploadImage } from '../api'
import SlidePreview from '../carousel/SlidePreview'
import { TEMPLATES, FONTS, templateOf } from '../carousel/templates'
import { downloadSlides, downloadSlide } from '../carousel/export'
import { drawable, aiSlideIds } from '../carousel/plan'
import { slideOverflows } from '../../../../shared/carousel-templates.mjs'

const STYLES = [['photo', '실제 사진처럼'], ['illustration', '일러스트'], ['texture', '질감 배경']]

// ---------- image picker: 내 보관함 · AI로 만들기 ----------
function ImagePicker({ slide, shape, topic, onPick, onClose }) {
  const { toast } = useStudio()
  const [tab, setTab] = useState('library')
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [scene, setScene] = useState(slide?.image || '')
  const [style, setStyle] = useState('photo')
  const [made, setMade] = useState(null)
  const file = useRef(null)
  const load = () => studio.images().then(setData).catch(e => toast({ kind: 'failed', title: '보관함을 열지 못했어요', body: e.message }))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const upload = async files => {
    setBusy(true)
    try { for (const f of [...files].slice(0, 10)) { const r = await uploadImage(f); if (r.duplicate) toast({ kind: 'ready', title: '이미 보관함에 있는 사진이에요', body: '같은 사진은 한 번만 저장해요.', ttl: 4000 }) } await load() }
    catch (e) { toast({ kind: 'failed', title: '올리지 못했어요', body: e.message }) } finally { setBusy(false); if (file.current) file.current.value = '' }
  }
  const remove = async image => {
    if (!window.confirm('보관함에서 지울까요? 이 사진을 쓴 캐러셀에서도 빠져요.')) return
    try { await studio.removeImage(image.id); setData(d => ({ ...d, images: d.images.filter(i => i.id !== image.id) })) } catch (e) { toast({ kind: 'failed', title: '지우지 못했어요', body: e.message }) }
  }
  const make = async tier => {
    setBusy(true)
    try { const r = await generateImage({ tier, shape, scene, style, slide: [slide?.heading, slide?.text].filter(Boolean).join(' '), topic, over: true }); setMade({ ...r.image, person: r.person, tier }); setData(d => d ? { ...d, ai: { ...d.ai, ...r.ai } } : d) }
    catch (e) { toast({ kind: 'failed', title: '이미지를 만들지 못했어요', body: e.message }) } finally { setBusy(false) }
  }
  const ai = data?.ai
  return <div className="st-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="st-modal-box" style={{ width: 'min(880px, 100%)' }}>
      <div className="st-row" style={{ justifyContent: 'space-between' }}><h2>사진 넣기</h2><button type="button" className="st-icon-btn" aria-label="닫기" onClick={onClose}><X size={20} /></button></div>
      <nav className="st-tabs" aria-label="사진 고르는 방법">{[['library', '내 보관함'], ['ai', 'AI로 만들기']].map(([id, name]) => <button type="button" key={id} className="st-tab" aria-pressed={tab === id} onClick={() => setTab(id)}>{name}</button>)}</nav>
      {tab === 'library' && <div className="st-stack">
        <div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-muted st-small">{data ? `${data.images.length} / ${data.limit}장` : '불러오는 중…'} · 내 사진을 올려 두면 어느 캐러셀에서든 꺼내 써요.</span>
          <button type="button" className="st-btn st-btn-soft" disabled={busy} onClick={() => file.current?.click()}>{busy ? <LoaderCircle size={18} className="st-spin" /> : <Upload size={18} />}사진 올리기</button>
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => upload(e.target.files)} /></div>
        {data && data.images.length === 0 && <div className="st-empty"><strong>보관함이 비어 있어요</strong><span>사진을 올리거나, AI로 만들어 넣어 보세요.</span></div>}
        <div className="st-cr-library">{(data?.images || []).map(image => <div key={image.id} className="st-cr-thumb">
          <button type="button" onClick={() => onPick(image)} aria-label="이 사진 쓰기"><img src={image.thumbUrl} alt="" loading="lazy" /></button>
          {image.source === 'ai' && <span className="st-pill">AI</span>}
          <button type="button" className="st-icon-btn st-cr-thumb-del" aria-label="보관함에서 지우기" onClick={() => remove(image)}><Trash2 size={14} /></button></div>)}</div>
      </div>}
      {tab === 'ai' && <div className="st-stack">
        {ai && !ai.ready ? <div className="st-note st-note-warn">AI 이미지 연결이 아직 준비되지 않았어요. (서버에 이미지 생성 키 설정이 필요해요)</div> : <>
          <div className="st-field"><label htmlFor="cr-scene">어떤 그림이 필요한가요?<small>장면을 한 줄로 적으면 훅ai가 그림 설명을 대신 써요. 글자는 그림에 넣지 않아요.</small></label>
            <input id="cr-scene" className="st-input" value={scene} maxLength={300} onChange={e => setScene(e.target.value)} placeholder="예) 저녁 부엌 조리대 위에 갓 구운 과자 한 판" /></div>
          <div className="st-chips">{STYLES.map(([id, name]) => <button type="button" key={id} className="st-chip st-chip-soft" aria-pressed={style === id} onClick={() => setStyle(id)}>{name}</button>)}</div>
          <div className="st-row"><button type="button" className="st-btn st-btn-primary" disabled={busy || (!scene.trim() && !slide?.text)} onClick={() => make('economy')}>{busy ? <LoaderCircle size={18} className="st-spin" /> : <Sparkles size={18} />}{made ? '다시 만들기' : '만들기'}</button>
            {made && <button type="button" className="st-btn" disabled={busy} onClick={() => make('standard')}>고화질로 다시 만들기</button>}
            {ai && <span className="st-muted st-small">이번 달 {ai.used} / {ai.allowance}장 · 고화질은 1장이 {ai.tiers?.standard?.weight || 5}장으로 계산돼요</span>}</div>
          {made?.person && made.tier === 'economy' && <p className="st-note st-small">사람 얼굴이 크게 나오는 장면이에요. 얼굴이 어색하면 [고화질로 다시 만들기]를 써 보세요.</p>}
          {made && <div className="st-cr-made"><img src={made.url} alt="AI로 만든 이미지" /><button type="button" className="st-btn st-btn-primary" onClick={() => onPick({ ...made, source: 'ai' })}><Check size={18} />이 그림 쓰기</button></div>}
          <p className="st-muted st-small">AI로 만든 그림이 들어간 장은 받을 때 파일 정보에 'AI 생성 이미지 포함'이 기록돼요. 실제 인물·브랜드·작품은 만들 수 없어요. 쓰지 않은 그림은 7일 뒤 지워져요.</p>
        </>}
      </div>}
    </div>
  </div>
}

// ---------- 디자인 ----------
const COLOR_NAMES = [['background', '배경'], ['text', '글자'], ['accent', '포인트']]
export function DesignStage({ carousel, images, save }) {
  const { toast } = useStudio()
  const slides = carousel.slides.items, design = carousel.design
  const template = templateOf(design.template)
  const [selected, setSelected] = useState(slides[0].id)
  const [picker, setPicker] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState('')
  const [handle, setHandle] = useState(design.handle || '')
  const view = useMemo(() => drawable(design, images), [design, images])
  const current = slides.find(s => s.id === selected) || slides[0], index = slides.indexOf(current)
  const slots = template.images[current.role] || 0
  const set = patch => save({ design: { ...design, ...patch } })
  const setImage = (key, value) => set({ slides: { ...design.slides, [current.id]: { image: design.slides?.[current.id]?.image || null, image2: design.slides?.[current.id]?.image2 || null, [key]: value } } })
  const placed = key => design.slides?.[current.id]?.[key] || null
  const missing = template.imageRequired ? slides.filter(s => (template.images[s.role] || 0) > 0 && !design.slides?.[s.id]?.image).length : 0
  const download = async one => {
    setDownloading(true)
    try {
      const ai = aiSlideIds(design, images)
      if (one) await downloadSlide(current, index, slides.length, view, { name: carousel.title || 'carousel', aiGenerated: ai.includes(current.id) })
      else await downloadSlides(slides, view, { name: carousel.title || 'carousel', aiSlideIds: ai, onProgress: (done, total) => setProgress(`${done} / ${total}`) })
      if (ai.length) toast({ kind: 'ready', title: '받았어요', body: 'AI로 만든 그림이 들어간 장에는 파일 정보에 표시가 기록돼요. 인스타그램이 이를 읽고 AI 정보 라벨을 붙일 수 있어요.', ttl: 9000 })
    } catch (e) { toast({ kind: 'failed', title: '이미지를 만들지 못했어요', body: e.message }) } finally { setDownloading(false); setProgress('') }
  }
  return <div className="st-stack">
    <section className="st-card st-stack">
      <div className="st-card-head"><div><h3>틀</h3><p>틀을 바꾸면 모든 장이 한 번에 다시 배치돼요. 글은 그대로예요.</p></div>
        <div className="st-chips">{['4:5', '3:4'].map(r => <button type="button" key={r} className="st-chip st-chip-soft" aria-pressed={design.ratio === r} onClick={() => set({ ratio: r })}>{r}</button>)}</div></div>
      <div className="st-chips">{TEMPLATES.map(t => <button type="button" key={t.id} className="st-chip st-chip-soft" aria-pressed={t.id === design.template} onClick={() => save({ design: { ...design, template: t.id }, slides: { template: t.id } })}>{t.name}</button>)}</div>
      <div className="st-cr-controls">
        {COLOR_NAMES.map(([key, name]) => <label key={key} className="st-cr-color">{name}<input type="color" value={design.colors?.[key] || template.colors[key]} onChange={e => set({ colors: { ...design.colors, [key]: e.target.value.toUpperCase() } })} /></label>)}
        {Object.keys(design.colors || {}).length > 0 && <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => set({ colors: {} })}>색 되돌리기</button>}
        {[['heading', '제목 글꼴'], ['body', '본문 글꼴']].map(([key, name]) => <label key={key} className="st-cr-font">{name}<select className="st-select" style={{ minHeight: 44, fontSize: 15 }} value={design.fonts?.[key] || template.fonts[key]} onChange={e => set({ fonts: { ...design.fonts, [key]: e.target.value } })}>{FONTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>)}
        <label className="st-cr-font">내 아이디<input className="st-input" style={{ minHeight: 44, fontSize: 15 }} value={handle} maxLength={40} placeholder="@my.account" onChange={e => setHandle(e.target.value)} onBlur={() => handle !== (design.handle || '') && set({ handle })} /></label>
        <button type="button" className="st-btn st-btn-soft st-btn-sm" title="다음 캐러셀도 이 틀·색·글꼴·아이디로 시작해요" onClick={() => studio.saveCarouselDesign({ ...design, handle }).then(() => toast({ kind: 'ready', title: '내 디자인으로 저장했어요', body: '다음에 만드는 캐러셀은 이 모양으로 시작해요.', ttl: 5000 })).catch(e => toast({ kind: 'failed', title: '저장하지 못했어요', body: e.message }))}><Check size={16} />내 디자인으로 저장</button>
      </div>
    </section>
    {missing > 0 && <div className="st-note st-note-warn st-small">이 틀은 사진이 있어야 완성돼요. 사진이 빠진 장이 {missing}장 있어요. 장을 눌러 사진을 넣어 주세요.</div>}
    <div className="st-cr-design">
      <div className="st-cr-grid">{slides.map((s, i) => <button type="button" key={s.id} className="st-cr-cell" aria-pressed={s.id === current.id} onClick={() => setSelected(s.id)}>
        <SlidePreview slide={s} index={i} total={slides.length} design={view} />
        <span className="st-cr-cell-n">{i + 1}{slideOverflows(design.template, s) ? ' · 글 많음' : ''}</span></button>)}</div>
      <aside className="st-card st-stack st-cr-side">
        <strong>{index + 1}장</strong>
        <SlidePreview slide={current} index={index} total={slides.length} design={view} />
        {slots === 0 ? <p className="st-muted st-small">이 틀은 이 장에 사진을 쓰지 않아요.</p>
          : [['image', slots > 1 ? '위 사진' : '사진'], ...(slots > 1 ? [['image2', '아래 사진']] : [])].map(([key, name]) => { const value = placed(key)
            return <div key={key} className="st-stack" style={{ gap: 8 }}>
              <div className="st-row"><button type="button" className="st-btn st-btn-soft st-btn-sm" onClick={() => setPicker(key)}><ImagePlus size={16} />{value ? `${name} 바꾸기` : `${name} 넣기`}</button>{value && <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setImage(key, null)}>빼기</button>}</div>
              {value && <div className="st-cr-crop">{[['x', '좌우'], ['y', '상하'], ['zoom', '확대']].map(([axis, label]) => <label key={axis}>{label}<input type="range" min={axis === 'zoom' ? 1 : 0} max={axis === 'zoom' ? 3 : 1} step="0.02" defaultValue={value[axis]} onPointerUp={e => setImage(key, { ...value, [axis]: Number(e.target.value) })} onKeyUp={e => setImage(key, { ...value, [axis]: Number(e.target.value) })} /></label>)}</div>}
            </div> })}
        <button type="button" className="st-btn st-btn-sm" disabled={downloading} onClick={() => download(true)}><Download size={16} />이 장만 받기</button>
      </aside>
    </div>
    <section className="st-card st-row" style={{ justifyContent: 'space-between' }}>
      <div><strong>이미지로 받기</strong><p className="st-muted st-small">모든 장을 PNG로 만들어 한 번에 받아요. 올릴 때는 번호 순서대로 올리면 돼요.</p></div>
      <button type="button" className="st-btn st-btn-primary st-btn-big" disabled={downloading} onClick={() => download(false)}>{downloading ? <LoaderCircle size={20} className="st-spin" /> : <Download size={20} />}{downloading && progress ? `만드는 중 ${progress}` : `전체 받기 (${slides.length}장)`}</button>
    </section>
    {picker && <ImagePicker slide={current} shape={slots > 1 ? 'half' : design.ratio} topic={carousel.topic?.title || ''} onClose={() => setPicker(null)}
      onPick={image => { setImage(picker, { id: image.id, x: 0.5, y: 0.5, zoom: 1 }); setPicker(null) }} />}
  </div>
}
