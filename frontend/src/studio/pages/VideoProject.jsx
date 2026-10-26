import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Play, Pause, Undo2, Redo2, Scissors, Captions, Download, Sparkles, LoaderCircle, Check, RotateCcw, Wand2, ArrowLeft, Film } from 'lucide-react'
import { SUBTITLE_PRESETS } from '../../../../shared/subtitle-layout.mjs'
import { CreatorSubtitleOverlay } from '../../components/CreatorSubtitleControls'
import { durationOf, editHistory, projectCaptions, timeLabel, toSrt } from '../../lib/demoTimeline'
import { diagnoseTempo } from '../../lib/tempoDiagnosis'
import '../../components/DemoVideoEditor.css'
import { useStudio } from '../context'
import { studio } from '../api'

// One video, four steps a first-time student can follow: 훅ai's feedback → cut by sentences → subtitles → export.
const AREA = { hook: '첫 3초', flow: '흐름', subtitles: '자막 읽기', information: '정보 전달', cta: '마무리' }
const STEPS = [['feedback', '훅ai 피드백', Sparkles], ['cut', '컷 편집', Scissors], ['subtitles', '자막', Captions], ['export', '영상 받기', Download]]
const overlaps = (a, b) => a.start < b.end && b.start < a.end

// Ranges to drop (removed cues + silent gaps) → the clips that stay, in source time.
function keptClips(duration, ranges) {
  const merged = [...ranges].filter(r => r.end > r.start).sort((a, b) => a.start - b.start).reduce((out, r) => {
    const last = out.at(-1)
    if (last && r.start <= last.end + 0.02) last.end = Math.max(last.end, r.end); else out.push({ ...r })
    return out
  }, [])
  const clips = []
  let at = 0
  for (const r of merged) { if (r.start - at >= 0.08) clips.push({ start: at, end: r.start }); at = Math.max(at, r.end) }
  if (duration - at >= 0.08) clips.push({ start: at, end: duration })
  return clips.map((c, i) => ({ id: `keep-${i}`, start: +c.start.toFixed(3), end: +c.end.toFixed(3) }))
}

function initialDraft(media) {
  const m = media.manifest, duration = Number(media.durationSeconds)
  const clips = m.clips || null
  const inGap = r => clips && !clips.some(c => (Math.min(c.end, r.end) - Math.max(c.start, r.start)) > (r.end - r.start) / 2)
  return {
    removed: (m.subtitles || []).filter(inGap).map(c => c.id),
    silence: Boolean(clips && (m.cuts || []).length && (m.cuts || []).every(inGap)),
    subtitles: (m.subtitles || []).map(c => ({ id: c.id, start: c.start, end: c.end, text: c.text })),
    style: { preset: m.subtitleStyle?.preset || 'outline', burnIn: m.subtitleStyle?.burnIn !== false },
    duration,
  }
}
const clipsOf = (d, cuts) => keptClips(d.duration, [...d.subtitles.filter(c => d.removed.includes(c.id)), ...(d.silence ? cuts : [])])

export default function VideoProject({ job }) {
  const { go, toast } = useStudio()
  const projectId = job.result?.projectId || job.projectId
  const feedback = job.result?.feedback || null
  const [media, setMedia] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { studio.media(projectId).then(setMedia).catch(e => setError(e.message)) }, [projectId])
  if (error) return <div className="st-error" role="alert">{error}</div>
  if (!media) return <p className="st-muted">영상을 불러오는 중…</p>
  return <Editor key={media.id} media={media} setMedia={setMedia} feedback={feedback} plan={job.plan} go={go} toast={toast} />
}

function Editor({ media, setMedia, feedback, plan, go, toast }) {
  const cuts = useMemo(() => media.manifest.cuts || [], [media.manifest.cuts])
  const [history, dispatch] = useReducer(editHistory, media, m => ({ past: [], present: initialDraft(m), future: [] }))
  const draft = history.present
  const edit = useCallback(patch => dispatch({ type: 'edit', project: { ...history.present, ...(typeof patch === 'function' ? patch(history.present) : patch) } }), [history.present])
  const [step, setStep] = useState('feedback')
  const [revision, setRevision] = useState(media.revision)
  const [saveState, setSaveState] = useState('saved')
  const [fixing, setFixing] = useState(false)
  const [render, setRender] = useState(null)
  const clips = useMemo(() => clipsOf(draft, cuts), [draft, cuts])
  const after = durationOf(clips)
  const removedRanges = useMemo(() => keptClips(draft.duration, clips.map(c => ({ start: c.start, end: c.end }))), [clips, draft.duration])
  const hookItems = media.manifest.hookDiagnosis?.items || []
  const suggestRemove = hookItems.filter(i => i.action === 'remove')
  const tempo = useMemo(() => diagnoseTempo(media.manifest.subtitles || [], draft.duration), [media.manifest.subtitles, draft.duration])

  // ---- player: plays the source but jumps over the parts the student removed ----
  const video = useRef(null)
  const stopAt = useRef(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    let frame
    const tick = () => {
      const v = video.current
      if (v && !v.paused) {
        const gap = removedRanges.find(r => v.currentTime >= r.start && v.currentTime < r.end - 0.03)
        if (gap) v.currentTime = Math.min(gap.end, draft.duration)
        if (stopAt.current !== null && v.currentTime >= stopAt.current) { v.pause(); stopAt.current = null }
        setTime(v.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [removedRanges, draft.duration])
  const playRange = (start, end) => { const v = video.current; if (!v) return; v.currentTime = start; stopAt.current = end; void v.play().catch(() => {}) }
  const toggle = () => { const v = video.current; if (!v) return; stopAt.current = null; if (v.paused) { if (v.currentTime >= draft.duration - 0.1) v.currentTime = clips[0]?.start || 0; void v.play().catch(() => {}) } else v.pause() }
  const cue = draft.subtitles.find(c => !draft.removed.includes(c.id) && time >= c.start && time < c.end)

  // ---- autosave the edit to the project (the server re-validates every cut and subtitle) ----
  const manifestOf = d => ({ cuts: cuts.map(c => ({ id: c.id, enabled: false })), subtitles: d.subtitles.map(({ start, end, text }) => ({ start, end, text: text.trim() })), clips: clipsOf(d, cuts), subtitleStyle: d.style })
  const first = useRef(true)
  const pending = useRef(null)
  const saveNow = useCallback(async (d = history.present) => {
    if (d.subtitles.some(c => !c.text.trim())) { setSaveState('invalid'); return null }
    setSaveState('saving')
    try {
      const res = await studio.saveMedia(media.id, revision, manifestOf(d))
      setRevision(res.revision); setSaveState('saved'); return res.revision
    } catch (e) { setSaveState('error'); toast({ kind: 'failed', title: '편집을 저장하지 못했어요', body: e.message }); return null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id, revision, history.present])
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setSaveState('dirty')
    clearTimeout(pending.current)
    pending.current = setTimeout(() => { void saveNow(draft) }, 1200)
    return () => clearTimeout(pending.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const toggleCue = id => edit(d => ({ removed: d.removed.includes(id) ? d.removed.filter(x => x !== id) : [...d.removed, id] }))
  const applySuggestions = () => edit(d => ({ removed: [...new Set([...d.removed, ...d.subtitles.filter(c => suggestRemove.some(s => overlaps(s, c))).map(c => c.id)])] }))
  const setText = (id, text) => edit(d => ({ subtitles: d.subtitles.map(c => c.id === id ? { ...c, text } : c) }))
  const fixWithPlan = async () => {
    setFixing(true)
    try {
      clearTimeout(pending.current)
      if (await saveNow(draft) === null) return
      const res = await studio.fixSubtitles(media.id, plan.id)
      edit(d => ({ subtitles: d.subtitles.map((c, i) => res.subtitles[i] ? { ...c, text: res.subtitles[i].text } : c) }))
      toast({ kind: 'ready', title: res.changed ? `자막 ${res.changed}곳을 대본에 맞게 고쳤어요` : '대본과 다른 자막이 없었어요', body: res.changed ? '마음에 안 들면 위의 되돌리기를 누르세요.' : '' })
    } catch (e) { toast({ kind: 'failed', title: '자막을 고치지 못했어요', body: e.message }) } finally { setFixing(false) }
  }
  const startRender = async () => {
    clearTimeout(pending.current)
    const rev = await saveNow(draft)
    if (rev === null) return
    try { const j = await studio.renderMedia(media.id, rev); setRender(j) } catch (e) { toast({ kind: 'failed', title: '영상을 만들지 못했어요', body: e.message }) }
  }
  useEffect(() => {
    if (!render || !['queued', 'running'].includes(render.status)) return undefined
    const timer = setTimeout(async () => {
      try { const next = await studio.job(render.id); setRender(next); if (next.status === 'completed') setMedia(await studio.media(media.id)) } catch { /* keep polling */ }
    }, 3000)
    return () => clearTimeout(timer)
  }, [render, media.id, setMedia])
  const downloadSrt = () => {
    const out = projectCaptions(clips.map(c => ({ ...c, assetId: 'o' })), draft.subtitles.filter(c => !draft.removed.includes(c.id)).map(c => ({ ...c, assetId: 'o' })))
    const url = URL.createObjectURL(new Blob([toSrt(out)], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${media.originalName.replace(/\.[^.]+$/, '')}-자막.srt`; a.click(); URL.revokeObjectURL(url)
  }

  const findings = (feedback?.findings || []).filter(f => f.problem !== '확인되지 않음')
  const unchecked = (feedback?.findings || []).filter(f => f.problem === '확인되지 않음').map(f => AREA[f.area])
  const SAVE_LABEL = { saved: '저장됨', saving: '저장 중…', dirty: '고치는 중', error: '저장 실패', invalid: '빈 자막이 있어요' }

  return <div className="st-ve">
    <div className="st-ve-head">
      <button type="button" className="st-btn st-btn-sm" onClick={() => go('edit')}><ArrowLeft size={16} />영상 편집</button>
      <div><strong>{plan?.title || media.originalName}</strong><span className="st-muted st-small">원래 {timeLabel(draft.duration)} → 편집 후 {timeLabel(after)}</span></div>
      <div className="st-row" style={{ gap: 8 }}>
        <span className={`st-pill ${saveState === 'saved' ? 'st-pill-green' : 'st-pill-gray'}`}>{SAVE_LABEL[saveState]}</span>
        <button type="button" className="st-icon-btn" aria-label="되돌리기" title="되돌리기" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={18} /></button>
        <button type="button" className="st-icon-btn" aria-label="다시 하기" title="다시 하기" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={18} /></button>
      </div>
    </div>
    <div className="st-ve-grid">
      <div className="st-ve-player">
        <div className="st-ve-stage">
          {media.previewUrl ? <video ref={video} src={media.previewUrl} playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle} /> : <div className="st-ve-expired"><Film size={32} />원본 보관 기간(24시간)이 지나 미리보기를 볼 수 없어요. 자막 파일은 받을 수 있어요.</div>}
          {media.previewUrl && <CreatorSubtitleOverlay videoRef={video} cue={cue} preset={draft.style.preset} />}
        </div>
        <div className="st-ve-controls">
          <button type="button" className="st-btn st-btn-primary" disabled={!media.previewUrl} onClick={toggle}>{playing ? <><Pause size={18} />멈춤</> : <><Play size={18} />편집한 대로 보기</>}</button>
          <span className="st-muted">{timeLabel(time)} / {timeLabel(draft.duration)}</span>
        </div>
      </div>
      <div className="st-ve-panel">
        <div className="st-ve-steps" role="tablist">{STEPS.map(([id, label, icon], i) => { const Icon = icon; return <button type="button" role="tab" key={id} aria-selected={step === id} onClick={() => setStep(id)}><b>{i + 1}</b><Icon size={17} />{label}</button> })}</div>

        {step === 'feedback' && <div className="st-stack">
          {!feedback && <p className="st-muted">이 영상은 피드백 없이 편집용으로만 분석됐어요.</p>}
          {tempo.available && (tempo.delayedStart || tempo.firstThreeChars < 6) && <article className="st-ve-note"><strong>첫 3초</strong><p>{tempo.delayedStart ? `첫 말이 ${tempo.firstStart.toFixed(1)}초에 시작해요. 시청자는 3초 안에 넘길지 정하니, 앞부분을 잘라 바로 말로 시작해 보세요.` : '첫 3초에 나오는 말이 적어요. 무슨 영상인지 첫 마디로 바로 알려주면 덜 넘겨요.'}</p><button type="button" className="st-btn st-btn-sm" onClick={() => playRange(0, Math.min(3.5, draft.duration))}><Play size={15} />첫 3초 보기</button></article>}
          {findings.map((f, i) => <article key={i} className="st-ve-finding">
            <div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{AREA[f.area]}</span>{f.start !== null && <button type="button" className="st-btn st-btn-sm" onClick={() => playRange(f.start, f.end)}><Play size={15} />{timeLabel(f.start)} 부분 보기</button>}</div>
            <strong>{f.problem}</strong><p>{f.reason}</p>
            <div className="st-ve-example"><span>이렇게 바꿔 보세요</span>{f.example}</div>
          </article>)}
          {hookItems.filter(h => h.action !== 'remove').map(h => <article key={h.id} className="st-ve-finding"><div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{AREA[h.area]}</span><button type="button" className="st-btn st-btn-sm" onClick={() => playRange(h.start, h.end)}><Play size={15} />{timeLabel(h.start)} 부분 보기</button></div><strong>“{h.quote}”</strong><p>{h.reason}</p></article>)}
          {suggestRemove.length > 0 && <article className="st-ve-note"><strong>빼도 되는 말 {suggestRemove.length}곳</strong><p>같은 말을 다시 하는 부분이에요. 컷 편집에서 한 번에 뺄 수 있어요.</p><button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={() => setStep('cut')}><Scissors size={15} />컷 편집으로</button></article>}
          {unchecked.length > 0 && <p className="st-muted st-small">{unchecked.join(' · ')}은(는) 이번 영상에서 확인하지 못했어요.</p>}
          <p className="st-muted st-small">조회수를 예측하는 점수가 아니라, 올리기 전에 완성도를 높이기 위한 참고 의견이에요.</p>
        </div>}

        {step === 'cut' && <div className="st-stack">
          <p className="st-muted">빼고 싶은 말을 누르면 그 부분이 영상에서 잘려요. 다시 누르면 되살아나요. 왼쪽 ‘편집한 대로 보기’로 바로 확인하세요.</p>
          <div className="st-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {suggestRemove.length > 0 && <button type="button" className="st-btn st-btn-sm st-btn-soft" onClick={applySuggestions}><Wand2 size={15} />훅ai 추천대로 반복된 말 빼기</button>}
            {cuts.length > 0 && <button type="button" className={`st-btn st-btn-sm${draft.silence ? ' st-btn-primary' : ''}`} onClick={() => edit(d => ({ silence: !d.silence }))}>{draft.silence ? <Check size={15} /> : <Scissors size={15} />}말 없는 부분 {cuts.length}곳 {draft.silence ? '빼는 중' : '빼기'}</button>}
            {draft.removed.length > 0 && <button type="button" className="st-btn st-btn-sm" onClick={() => edit({ removed: [], silence: false })}><RotateCcw size={15} />모두 되살리기</button>}
          </div>
          <ol className="st-ve-lines">{draft.subtitles.map(c => { const off = draft.removed.includes(c.id); const hint = suggestRemove.some(s => overlaps(s, c))
            return <li key={c.id} className={`${off ? 'is-off' : ''}${time >= c.start && time < c.end ? ' is-now' : ''}`}>
              <button type="button" className="st-ve-time" onClick={() => playRange(c.start, c.end)} aria-label={`${timeLabel(c.start)} 부분 듣기`}><Play size={13} />{timeLabel(c.start)}</button>
              <span className="st-ve-text">{c.text}{hint && !off && <em>훅ai: 반복이라 빼도 돼요</em>}</span>
              <button type="button" className={`st-btn st-btn-sm${off ? '' : ' st-ve-cut'}`} onClick={() => toggleCue(c.id)}>{off ? '되살리기' : '빼기'}</button>
            </li> })}</ol>
        </div>}

        {step === 'subtitles' && <div className="st-stack">
          <div className="st-ve-styles">{Object.entries(SUBTITLE_PRESETS).map(([id, p]) => <button type="button" key={id} aria-pressed={draft.style.preset === id} onClick={() => edit(d => ({ style: { ...d.style, preset: id } }))}><span className={`st-ve-swatch st-ve-swatch-${id}`}><i>가나다</i></span>{p.label}</button>)}</div>
          <label className="st-ve-consent"><input type="checkbox" checked={draft.style.burnIn} onChange={e => edit(d => ({ style: { ...d.style, burnIn: e.target.checked } }))} />완성 영상에 자막을 입혀서 만들기</label>
          {plan?.id && <button type="button" className="st-btn st-btn-soft" disabled={fixing} onClick={fixWithPlan}>{fixing ? <><LoaderCircle size={16} className="st-spin" />대본과 비교하는 중…</> : <><Wand2 size={16} />기획안 대본으로 자막 오타 고치기</>}</button>}
          <p className="st-muted st-small">잘못 들린 단어를 눌러서 바로 고치세요. 뺀 말의 자막은 완성 영상에 나오지 않아요.</p>
          <ol className="st-ve-lines">{draft.subtitles.map(c => <li key={c.id} className={`${draft.removed.includes(c.id) ? 'is-off' : ''}${time >= c.start && time < c.end ? ' is-now' : ''}`}>
            <button type="button" className="st-ve-time" onClick={() => playRange(c.start, c.end)} aria-label={`${timeLabel(c.start)} 부분 듣기`}><Play size={13} />{timeLabel(c.start)}</button>
            <textarea className="st-ve-input" rows={1} value={c.text} maxLength={500} onChange={e => setText(c.id, e.target.value)} aria-label={`${timeLabel(c.start)} 자막`} />
          </li>)}</ol>
        </div>}

        {step === 'export' && <div className="st-stack">
          <div className="st-ve-summary">
            <div><span>영상 길이</span><strong>{timeLabel(draft.duration)} → {timeLabel(after)}</strong></div>
            <div><span>뺀 말</span><strong>{draft.removed.length}곳{draft.silence ? ` + 말 없는 부분 ${cuts.length}곳` : ''}</strong></div>
            <div><span>자막</span><strong>{draft.style.burnIn ? SUBTITLE_PRESETS[draft.style.preset].label : '입히지 않음(파일만)'}</strong></div>
          </div>
          {render && ['queued', 'running'].includes(render.status) ? <div className="st-ve-note"><strong><LoaderCircle size={16} className="st-spin" /> 영상을 만드는 중이에요</strong><p>1~3분 걸려요. 다른 화면을 봐도 계속 만들어져요.</p></div>
            : render?.status === 'failed' ? <div className="st-error" role="alert">{render.error?.message || '영상을 만들지 못했어요. 다시 시도해주세요.'}</div> : null}
          {(media.videoUrl || media.downloadUrl) && saveState === 'saved' && !(render && ['queued', 'running'].includes(render.status)) && <>
            <a className="st-btn st-btn-primary st-btn-lg" href={media.videoUrl || media.downloadUrl} download><Download size={20} />완성 영상 받기</a>
            {media.videoUrl && media.downloadUrl && <a className="st-btn" href={media.downloadUrl} download><Download size={18} />영상·자막·원본 한꺼번에 받기 (압축 파일)</a>}
          </>}
          <button type="button" className={`st-btn st-btn-lg${media.downloadUrl ? '' : ' st-btn-primary'}`} disabled={!media.previewUrl || (render && ['queued', 'running'].includes(render.status))} onClick={startRender}><Film size={20} />{media.downloadUrl ? '지금 편집으로 다시 만들기' : '완성 영상 만들기'}</button>
          <button type="button" className="st-btn" onClick={downloadSrt}><Captions size={18} />자막 파일(SRT)만 받기</button>
          <p className="st-muted st-small">완성 파일은 7일 동안 받을 수 있어요. 캡컷 같은 앱에서 더 다듬으려면 자막 파일을 함께 쓰세요.</p>
        </div>}
      </div>
    </div>
  </div>
}
