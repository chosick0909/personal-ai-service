import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Play, Pause, Undo2, Redo2, Scissors, Captions, Download, Sparkles, LoaderCircle, Check, RotateCcw, Wand2, ArrowLeft, Film, Trash2, Copy, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Plus, Merge, ArrowLeftToLine, ArrowRightToLine } from 'lucide-react'
import { SUBTITLE_PRESETS, captionWords, groupSubtitles, splitSubtitle, wordBoundaries } from '../../../../shared/subtitle-layout.mjs'
import { CreatorSubtitleOverlay } from '../../components/CreatorSubtitleControls'
import { MIN_CLIP, durationOf, editHistory, locateTime, projectCaptions, splitClip, timeLabel, timelineRows, toSrt } from '../../lib/demoTimeline'
import { subtractSourceRanges } from '../../lib/sourceCuts'
import { diagnoseTempo } from '../../lib/tempoDiagnosis'
import '../../components/DemoVideoEditor.css'
import { useStudio } from '../context'
import { studio } from '../api'

// One video, edited the way CapCut does it: a player, a timeline underneath (video clips and subtitles you can select,
// split, trim, drag, reorder and duplicate), and beside them 훅ai's feedback, cutting by sentence, subtitles and export.
// The edit is a list of clips in source time, played one after another; subtitles stay in source time and follow the clips.
const AREA = { hook: '첫 3초', flow: '흐름', subtitles: '자막 읽기', information: '정보 전달', cta: '마무리' }
const STEPS = [['feedback', '훅ai 피드백', Sparkles], ['cut', '문장 빼기', Scissors], ['subtitles', '자막', Captions], ['export', '영상 받기', Download]]
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8]
const PAD = 16
const MIN_CUE = 0.1
const overlaps = (a, b) => a.start < b.end && b.start < a.end
// Times are cut to the millisecond downwards, so a clip never ends past the original (the server refuses that).
const ms = v => Math.floor(v * 1000 + 1e-6) / 1000
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const covered = (clips, r) => clips.reduce((n, c) => n + Math.max(0, Math.min(c.end, r.end) - Math.max(c.start, r.start)), 0)
const isOut = (clips, r) => covered(clips, r) < (r.end - r.start) / 2
// The playhead's time to a tenth of a second (00:02.4), as CapCut shows it.
const clock = t => { const d = Math.max(0, Math.floor(t * 10 + 1e-6) / 10); return `${String(Math.floor(d / 60)).padStart(2, '0')}:${(d % 60).toFixed(1).padStart(4, '0')}` }
const typing = el => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)

// Takes source ranges out of every clip (a duplicated clip loses them too); slivers too short to keep go with them.
function cutOut(clips, ranges, makeId) {
  const out = subtractSourceRanges(clips, ranges, makeId).map(c => ({ ...c, start: ms(c.start), end: ms(c.end) })).filter(c => c.end - c.start >= MIN_CLIP)
  return out.length ? out : null
}
// Puts source ranges back: each missing piece goes right after the clip that ends where it starts, and joins it.
function restore(clips, ranges, makeId) {
  let out = clips.map(c => ({ ...c }))
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    let gaps = [{ start: r.start, end: r.end }]
    for (const c of out) gaps = gaps.flatMap(g => c.end <= g.start || c.start >= g.end ? [g] : [...(c.start > g.start ? [{ start: g.start, end: c.start }] : []), ...(c.end < g.end ? [{ start: c.end, end: g.end }] : [])])
    for (const g of gaps) {
      // A sliver too short to have been kept between this piece and a neighbour comes back with it.
      for (const c of out) { if (c.start > g.end && c.start - g.end < MIN_CLIP) g.end = c.start; if (c.end < g.start && g.start - c.end < MIN_CLIP) g.start = c.end }
      const at = out.reduce((best, c, i) => c.end <= g.start + 0.01 && (best < 0 || c.end >= out[best].end) ? i : best, -1) + 1
      out.splice(at, 0, { id: makeId(), start: ms(g.start), end: ms(g.end), added: true })
    }
  }
  out = out.reduce((acc, c) => { const last = acc.at(-1); if (last && (last.added || c.added) && Math.abs(last.end - c.start) < 0.01) { last.end = c.end; last.added = true } else acc.push({ ...c }); return acc }, [])
  return out.map(c => ({ id: c.id, start: c.start, end: c.end })).filter(c => c.end - c.start >= MIN_CLIP)
}

// Frames of the original for the video track (CapCut's filmstrip), taken once from the preview in the background.
function useFilmstrip(src, duration) {
  const [frames, setFrames] = useState([])
  const step = Math.max(0.5, duration / 40)
  useEffect(() => {
    if (!src || !duration) return undefined
    let stop = false
    const v = document.createElement('video')
    Object.assign(v, { crossOrigin: 'anonymous', muted: true, preload: 'auto', src })
    const canvas = document.createElement('canvas')
    const grab = t => new Promise((resolve, reject) => { v.addEventListener('seeked', resolve, { once: true }); setTimeout(reject, 4000); v.currentTime = t })
    v.addEventListener('loadeddata', async () => {
      canvas.height = 96; canvas.width = Math.round(96 * v.videoWidth / v.videoHeight) || 54
      const ctx = canvas.getContext('2d'), out = []
      for (let t = 0; t < duration && !stop; t += step) {
        try { await grab(Math.min(t + 0.05, duration - 0.05)); ctx.drawImage(v, 0, 0, canvas.width, canvas.height); out.push({ t, url: canvas.toDataURL('image/jpeg', 0.6) }) } catch { break }
        if (!stop && out.length % 8 === 0) setFrames([...out])
      }
      if (!stop) setFrames(out)
    }, { once: true })
    return () => { stop = true; v.removeAttribute('src'); v.load() }
  }, [src, duration, step])
  return { frames, step }
}

function initialDraft(media) {
  const m = media.manifest, duration = Number(media.durationSeconds)
  const clips = m.clips?.length ? m.clips.map(c => ({ id: c.id, start: c.start, end: Math.min(c.end, duration) })) : [{ id: 'clip-0', start: 0, end: ms(duration) }]
  return {
    clips,
    subtitles: (m.subtitles || []).map(c => ({ id: c.id, start: c.start, end: c.end, text: c.text })),
    style: { preset: m.subtitleStyle?.preset || 'outline', burnIn: m.subtitleStyle?.burnIn !== false },
    duration,
  }
}
function problemOf(d) {
  if (d.subtitles.some(c => !c.text.trim())) return '빈 자막이 있어요'
  if (d.clips.some(c => c.end - c.start < MIN_CLIP - 1e-6)) return '너무 짧은 조각이 있어요'
  const length = durationOf(d.clips)
  if (length < 0.5) return '영상이 너무 짧아요'
  if (length > 300) return '5분을 넘었어요'
  if (d.clips.length > 100) return '조각이 100개를 넘었어요'
  return ''
}

// Uploads are kept for 48 hours; the editor says how long is left and nudges the student to finish and post.
function KeepNotice({ expiresAt }) {
  const [now] = useState(() => Date.now())
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return null
  const hours = Math.max(0, Math.floor((end - now) / 3600000))
  const when = new Date(end).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return <p className="st-ve-keep">⏳ 이 영상은 <b>{when}</b>까지 보관돼요{hours > 0 ? ` · ${hours}시간 남았어요` : ' · 곧 사라져요'}. '가장 좋은 릴스는 오늘 올린 릴스'라고 하잖아요. 사라지기 전에 완성해서 올려 보세요! 🚀</p>
}

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
  const words = useMemo(() => media.manifest.words || [], [media.manifest.words])
  const [history, dispatch] = useReducer(editHistory, media, m => ({ past: [], present: initialDraft(m), future: [] }))
  const draft = history.present
  const edit = useCallback(patch => dispatch({ type: 'edit', project: { ...history.present, ...(typeof patch === 'function' ? patch(history.present) : patch) } }), [history.present])
  const counter = useRef(0)
  const newId = kind => `${kind}-${Date.now().toString(36)}-${++counter.current}`
  const [step, setStep] = useState('feedback')
  const [sel, setSel] = useState(null)
  const [drag, setDrag] = useState(null)
  const [revision, setRevision] = useState(media.revision)
  const [saveState, setSaveState] = useState('saved')
  const [fixing, setFixing] = useState(false)
  const [render, setRender] = useState(null)
  // While an edge is being dragged the timeline shows the change live; it becomes one undo step on release.
  const clips = useMemo(() => drag?.kind === 'clip' ? draft.clips.map(c => c.id === drag.id ? { ...c, start: drag.start, end: drag.end } : c) : draft.clips, [draft.clips, drag])
  const subtitles = useMemo(() => drag?.kind === 'cue' ? draft.subtitles.map(c => c.id === drag.id ? { ...c, start: drag.start, end: drag.end } : c) : draft.subtitles, [draft.subtitles, drag])
  const rows = useMemo(() => timelineRows(clips), [clips])
  const total = durationOf(clips)
  const outCues = useMemo(() => projectCaptions(clips.map(c => ({ ...c, assetId: 'o' })), subtitles.map(c => ({ ...c, assetId: 'o' }))), [clips, subtitles])
  const offIds = useMemo(() => new Set(subtitles.filter(c => isOut(clips, c)).map(c => c.id)), [clips, subtitles])
  const silenceOut = cuts.length > 0 && cuts.every(c => isOut(clips, c))
  const hookItems = media.manifest.hookDiagnosis?.items || []
  const suggestRemove = hookItems.filter(i => i.action === 'remove')
  const film = useFilmstrip(media.previewUrl, Number(media.durationSeconds))
  const tempo = useMemo(() => diagnoseTempo(media.manifest.subtitles || [], draft.duration), [media.manifest.subtitles, draft.duration])

  // ---- player: plays the clips one after another; pos is the time in the edited video ----
  const video = useRef(null)
  const idx = useRef(0)
  const stopAt = useRef(null)
  const sourceStop = useRef(null)
  const [pos, setPos] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const view = useRef({ clips, rows })
  view.current = { clips, rows }
  useEffect(() => {
    let frame
    const tick = () => {
      const v = video.current, { clips: cs, rows: rs } = view.current
      if (v) {
        if (sourceStop.current !== null) {
          // Listening to one sentence of the original (it may be one the student cut out).
          if (!v.paused && v.currentTime >= sourceStop.current) { v.pause(); sourceStop.current = null }
        } else if (cs.length) {
          if (idx.current >= cs.length) idx.current = cs.length - 1
          let c = cs[idx.current]
          if (!v.paused && v.currentTime >= c.end - 0.02) {
            if (idx.current + 1 < cs.length) { idx.current += 1; c = cs[idx.current]; v.currentTime = c.start }
            else { v.pause(); v.currentTime = c.end }
          }
          const out = rs[idx.current].offset + clamp(v.currentTime - c.start, 0, c.end - c.start)
          if (!v.paused && stopAt.current !== null && out >= stopAt.current) { v.pause(); stopAt.current = null }
          setPos(out)
        }
        setTime(v.currentTime)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  const seek = useCallback(t => {
    const loc = locateTime(view.current.clips, t)
    if (!loc) return
    sourceStop.current = null
    idx.current = loc.index
    if (video.current) video.current.currentTime = loc.sourceTime
    setPos(loc.time); setTime(loc.sourceTime)
  }, [])
  // After an edit the playhead stays at the same place in the edited video.
  useEffect(() => { if (!drag) seek(Math.min(pos, Math.max(0, total - 0.01))) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.clips])
  const play = () => { const v = video.current; if (v) void v.play().catch(() => {}) }
  const toggle = () => {
    const v = video.current; if (!v) return
    stopAt.current = null
    if (!v.paused) { v.pause(); return }
    if (sourceStop.current !== null || pos >= total - 0.05) seek(sourceStop.current !== null ? pos : 0)
    play()
  }
  // A sentence of the original, even one that is cut out of the edit.
  const listen = (start, end) => { const v = video.current; if (!v) return; v.currentTime = start; sourceStop.current = end; play() }
  const loc = locateTime(clips, pos)
  const cue = subtitles.find(c => !offIds.has(c.id) && time >= c.start && time < c.end)

  // ---- autosave the edit to the project (the server re-validates every clip and subtitle) ----
  const manifestOf = d => ({ cuts: cuts.map(c => ({ id: c.id, enabled: false })), subtitles: d.subtitles.map(({ start, end, text }) => ({ start, end, text: text.trim() })),
    clips: d.clips.map(c => ({ id: c.id, start: ms(c.start), end: Math.min(ms(c.end), d.duration) })), subtitleStyle: d.style })
  const first = useRef(true)
  const pending = useRef(null)
  const saveNow = useCallback(async (d = history.present) => {
    if (problemOf(d)) { setSaveState('invalid'); return null }
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

  // ---- clip tools (all at the playhead or on the selected clip) ----
  const selClip = sel?.kind === 'clip' ? draft.clips.find(c => c.id === sel.id) : null
  const selIndex = selClip ? draft.clips.indexOf(selClip) : -1
  const selCue = sel?.kind === 'cue' ? draft.subtitles.find(c => c.id === sel.id) : null
  const atHead = loc && draft.clips[loc.index]
  const canSplitClip = Boolean(atHead) && loc.sourceTime - atHead.start >= MIN_CLIP && atHead.end - loc.sourceTime >= MIN_CLIP
  const splitHere = () => {
    if (selCue && time > selCue.start && time < selCue.end) { splitCueAt(selCue, time); return }
    if (!canSplitClip) return
    const id = newId('clip')
    edit(d => ({ clips: splitClip(d.clips, atHead.id, ms(loc.sourceTime), id) }))
    setSel({ kind: 'clip', id })
  }
  const trimBefore = () => {
    if (!canSplitClip) return
    const offset = rows[loc.index].offset
    edit(d => ({ clips: d.clips.map(c => c.id === atHead.id ? { ...c, start: ms(loc.sourceTime) } : c) }))
    setTimeout(() => seek(offset), 0)
  }
  const trimAfter = () => {
    if (!canSplitClip) return
    edit(d => ({ clips: d.clips.map(c => c.id === atHead.id ? { ...c, end: ms(loc.sourceTime) } : c) }))
  }
  const deleteSelected = () => {
    if (selCue) { edit(d => ({ subtitles: d.subtitles.filter(c => c.id !== selCue.id) })); setSel(null); return }
    if (!selClip) return
    if (draft.clips.length < 2) { toast({ kind: 'failed', title: '마지막 조각은 지울 수 없어요', body: '앞뒤를 잘라서 길이를 줄여 보세요.' }); return }
    const next = draft.clips[selIndex + 1] || draft.clips[selIndex - 1]
    edit(d => ({ clips: d.clips.filter(c => c.id !== selClip.id) }))
    setSel(next ? { kind: 'clip', id: next.id } : null)
  }
  const moveClip = dir => {
    const to = selIndex + dir
    if (selIndex < 0 || to < 0 || to >= draft.clips.length) return
    edit(d => { const list = [...d.clips];[list[selIndex], list[to]] = [list[to], list[selIndex]]; return { clips: list } })
  }
  const duplicate = () => {
    if (!selClip) return
    if (draft.clips.length >= 100 || total + selClip.end - selClip.start > 300) { toast({ kind: 'failed', title: '더 복제할 수 없어요', body: '영상은 5분, 조각은 100개까지 만들 수 있어요.' }); return }
    const id = newId('clip')
    edit(d => ({ clips: d.clips.flatMap(c => c.id === selClip.id ? [c, { ...c, id }] : [c]) }))
    setSel({ kind: 'clip', id })
  }
  const setClipTime = (field, value) => {
    if (!selClip || !Number.isFinite(value)) return
    const start = field === 'start' ? clamp(ms(value), 0, selClip.end - MIN_CLIP) : selClip.start
    const end = field === 'end' ? clamp(ms(value), selClip.start + MIN_CLIP, draft.duration) : selClip.end
    edit(d => ({ clips: d.clips.map(c => c.id === selClip.id ? { ...c, start, end } : c) }))
  }

  // ---- cutting by sentence (the clips lose or get back that sentence's part of the original) ----
  const cutRanges = ranges => { const next = cutOut(draft.clips, ranges, () => newId('clip')); if (next) edit({ clips: next }); else toast({ kind: 'failed', title: '전부 뺄 수는 없어요', body: '영상이 조금은 남아야 해요.' }) }
  const toggleCue = c => offIds.has(c.id) ? edit(d => ({ clips: restore(d.clips, [c], () => newId('clip')) })) : cutRanges([c])
  const applySuggestions = () => cutRanges(draft.subtitles.filter(c => suggestRemove.some(s => overlaps(s, c))))
  const toggleSilence = () => silenceOut ? edit(d => ({ clips: restore(d.clips, cuts, () => newId('clip')) })) : cutRanges(cuts)

  // ---- subtitles (source time, in order, never overlapping) ----
  const cueIndex = id => draft.subtitles.findIndex(c => c.id === id)
  const setCue = (id, patch) => edit(d => ({ subtitles: d.subtitles.map(c => c.id === id ? { ...c, ...patch } : c) }))
  const setCueTime = (id, field, value) => {
    const i = cueIndex(id), c = draft.subtitles[i]
    if (!c || !Number.isFinite(value)) return
    const prevEnd = draft.subtitles[i - 1]?.end ?? 0, nextStart = draft.subtitles[i + 1]?.start ?? draft.duration
    if (field === 'start') setCue(id, { start: clamp(ms(value), prevEnd, c.end - MIN_CUE) })
    else setCue(id, { end: clamp(ms(value), c.start + MIN_CUE, nextStart) })
  }
  const splitCue = (c, after, at) => {
    const parts = splitSubtitle(c, after, ms(at), newId('cue'))
    if (!parts) return false
    edit(d => ({ subtitles: d.subtitles.flatMap(v => v.id === c.id ? parts : [v]) }))
    setSel({ kind: 'cue', id: c.id })
    return true
  }
  // At the playhead: between the words nearest to it, at exactly the playhead's time.
  function splitCueAt(c, at) {
    const bounds = wordBoundaries(c, words)
    if (!bounds.length) { toast({ kind: 'failed', title: '한 단어인 자막은 나눌 수 없어요', body: '' }); return }
    const near = bounds.reduce((a, b) => Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a)
    if (!splitCue(c, near.after, at)) toast({ kind: 'failed', title: '이 위치에서는 나눌 수 없어요', body: '자막의 맨 앞이나 맨 끝에 너무 가까워요. 재생선을 조금 옮겨 보세요.' })
  }
  const mergeNext = c => {
    const i = cueIndex(c.id), next = draft.subtitles[i + 1]
    if (!next) return
    if (c.text.length + next.text.length + 1 > 500) { toast({ kind: 'failed', title: '합치면 너무 길어요', body: '자막 하나는 500자까지예요.' }); return }
    edit(d => ({ subtitles: d.subtitles.flatMap(v => v.id === c.id ? [{ ...v, end: next.end, text: `${v.text} ${next.text}` }] : v.id === next.id ? [] : [v]) }))
  }
  const addCue = () => {
    if (!loc) return
    const at = ms(loc.sourceTime)
    if (draft.subtitles.some(c => at >= c.start && at < c.end)) { toast({ kind: 'failed', title: '여기엔 이미 자막이 있어요', body: '그 자막을 고치거나 나눠 보세요.' }); return }
    if (draft.subtitles.length >= 500) return
    const next = draft.subtitles.find(c => c.start > at)
    const end = ms(Math.min(at + 2, next?.start ?? draft.duration, draft.duration))
    if (end - at < 0.3) { toast({ kind: 'failed', title: '자막을 넣을 자리가 좁아요', body: '재생선을 자막 사이 빈 곳으로 옮겨 보세요.' }); return }
    const id = newId('cue')
    edit(d => ({ subtitles: [...d.subtitles, { id, start: at, end, text: '새 자막' }].sort((a, b) => a.start - b.start) }))
    setSel({ kind: 'cue', id, focus: true }); setStep('subtitles')
  }
  const shorten = () => edit(d => ({ subtitles: groupSubtitles(d.subtitles, words) }))

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
    const url = URL.createObjectURL(new Blob([toSrt(outCues)], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `${media.originalName.replace(/\.[^.]+$/, '')}-자막.srt`; a.click(); URL.revokeObjectURL(url)
  }

  // ---- keyboard, as in CapCut: space plays, ⌘B splits, Delete removes, ⌘Z undoes ----
  const keys = useRef(null)
  keys.current = { toggle, splitHere, deleteSelected, undo: () => dispatch({ type: 'undo' }), redo: () => dispatch({ type: 'redo' }) }
  useEffect(() => {
    const onKey = e => {
      if (typing(e.target)) return
      const k = keys.current, mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') { e.preventDefault(); k.toggle() }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); k.splitHere() }
      else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) k.redo(); else k.undo() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); k.deleteSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- timeline geometry ----
  const scroller = useRef(null)
  const [width, setWidth] = useState(800)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = scroller.current; if (!el) return undefined
    const ro = new ResizeObserver(() => setWidth(el.clientWidth)); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // The scale is set by the original's length, so cutting shortens the strip instead of rescaling it.
  const pps = Math.max(8, (width - PAD * 2) / Math.max(draft.duration, 1)) * zoom
  const xToTime = clientX => { const el = scroller.current, r = el.getBoundingClientRect(); return clamp((clientX - r.left + el.scrollLeft - PAD) / pps, 0, total) }
  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current; if (!el || !playing) return
    const x = PAD + pos * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 40
  }, [pos, pps, playing])
  const follow = (e, onMove) => {
    const target = e.currentTarget
    target.setPointerCapture?.(e.pointerId)
    const up = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onMove.done?.() }
    target.addEventListener('pointermove', onMove); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up)
  }
  const scrub = e => {
    if (e.button !== 0) return
    seek(xToTime(e.clientX))
    follow(e, ev => seek(xToTime(ev.clientX)))
  }
  // Dragging an edge of the selected clip (trims it in the original) or subtitle (moves its start or end).
  const dragEdge = (e, kind, item, side) => {
    e.stopPropagation(); e.preventDefault()
    const x0 = e.clientX
    const i = kind === 'cue' ? cueIndex(item.id) : -1
    const lo = kind === 'cue' ? (draft.subtitles[i - 1]?.end ?? 0) : 0
    const hi = kind === 'cue' ? (draft.subtitles[i + 1]?.start ?? draft.duration) : draft.duration
    const min = kind === 'cue' ? MIN_CUE : MIN_CLIP
    let last = { kind, id: item.id, start: item.start, end: item.end }
    const move = ev => {
      const dt = (ev.clientX - x0) / pps
      last = side === 'start' ? { ...last, start: ms(clamp(item.start + dt, lo, item.end - min)) } : { ...last, end: ms(clamp(item.end + dt, item.start + min, hi)) }
      setDrag(last)
    }
    move.done = () => {
      setDrag(null)
      if (last.start !== item.start || last.end !== item.end) edit(d => kind === 'clip'
        ? { clips: d.clips.map(c => c.id === item.id ? { ...c, start: last.start, end: last.end } : c) }
        : { subtitles: d.subtitles.map(c => c.id === item.id ? { ...c, start: last.start, end: last.end } : c) })
    }
    follow(e, move)
  }
  const pickClip = (e, c) => { e.stopPropagation(); setSel({ kind: 'clip', id: c.id }); seek(xToTime(e.clientX)) }
  const pickCue = (e, c) => { e.stopPropagation(); setSel({ kind: 'cue', id: c.id }); setStep('subtitles'); seek(xToTime(e.clientX)) }
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60].find(s => s * pps >= 70) || 60
  const ticks = Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, i) => i * tickStep)

  const findings = (feedback?.findings || []).filter(f => f.problem !== '확인되지 않음')
  const unchecked = (feedback?.findings || []).filter(f => f.problem === '확인되지 않음').map(f => AREA[f.area])
  const problem = problemOf(draft)
  const SAVE_LABEL = { saved: '저장됨', saving: '저장 중…', dirty: '고치는 중', error: '저장 실패', invalid: problem || '고칠 곳이 있어요' }
  const busy = Boolean(render && ['queued', 'running'].includes(render.status))

  return <div className="st-ve">
    <div className="st-ve-head">
      <button type="button" className="st-btn st-btn-sm" onClick={() => go('edit')}><ArrowLeft size={16} />영상 편집</button>
      <div><strong>{plan?.title || media.originalName}</strong><span className="st-muted st-small">원래 {timeLabel(draft.duration)} → 편집 후 {timeLabel(total)}</span></div>
      <div className="st-row" style={{ gap: 8 }}>
        <span className={`st-pill ${saveState === 'saved' ? 'st-pill-green' : 'st-pill-gray'}`}>{SAVE_LABEL[saveState]}</span>
        <button type="button" className="st-icon-btn" aria-label="되돌리기" title="되돌리기 (⌘Z)" disabled={!history.past.length} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={18} /></button>
        <button type="button" className="st-icon-btn" aria-label="다시 하기" title="다시 하기 (⌘⇧Z)" disabled={!history.future.length} onClick={() => dispatch({ type: 'redo' })}><Redo2 size={18} /></button>
      </div>
    </div>
    <KeepNotice expiresAt={media.originalExpiresAt} />
    <div className="st-ve-grid">
      <div className="st-ve-player">
        <div className="st-ve-stage">
          {media.previewUrl ? <video ref={video} src={media.previewUrl} playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={toggle} /> : <div className="st-ve-expired"><Film size={32} />원본 보관 기간(24시간)이 지나 미리보기를 볼 수 없어요. 자막 파일은 받을 수 있어요.</div>}
          {media.previewUrl && <CreatorSubtitleOverlay videoRef={video} cue={cue} preset={draft.style.preset} />}
        </div>
      </div>

      <div className="st-ve-panel">
        {selClip && <article className="st-ve-inspect" aria-label="선택한 조각">
          <div className="st-row" style={{ justifyContent: 'space-between' }}><strong>조각 {selIndex + 1} <span className="st-muted st-small">{(Math.floor((selClip.end - selClip.start) * 10 + 1e-6) / 10).toFixed(1)}초</span></strong><button type="button" className="st-btn st-btn-sm st-btn-ghost" onClick={() => setSel(null)}>닫기</button></div>
          <div className="st-ve-times">
            <label>원본에서 시작(초)<input type="number" step="0.1" min="0" value={Number(selClip.start.toFixed(2))} onChange={e => setClipTime('start', Number(e.target.value))} /></label>
            <label>원본에서 끝(초)<input type="number" step="0.1" min="0" max={draft.duration} value={Number(selClip.end.toFixed(2))} onChange={e => setClipTime('end', Number(e.target.value))} /></label>
          </div>
          <div className="st-ve-tools">
            <button type="button" className="st-btn st-btn-sm" disabled={selIndex < 1} onClick={() => moveClip(-1)}><ChevronLeft size={15} />앞으로</button>
            <button type="button" className="st-btn st-btn-sm" disabled={selIndex >= draft.clips.length - 1} onClick={() => moveClip(1)}>뒤로<ChevronRight size={15} /></button>
            <button type="button" className="st-btn st-btn-sm" onClick={duplicate}><Copy size={15} />복제</button>
            <button type="button" className="st-btn st-btn-sm st-btn-danger" onClick={deleteSelected}><Trash2 size={15} />삭제</button>
          </div>
          <p className="st-muted st-small">아래 타임라인에서 조각 양 끝의 손잡이를 끌어도 길이를 바꿀 수 있어요.</p>
        </article>}
        <div className="st-ve-steps" role="tablist">{STEPS.map(([id, label, icon], i) => { const Icon = icon; return <button type="button" role="tab" key={id} aria-selected={step === id} onClick={() => setStep(id)}><b>{i + 1}</b><Icon size={17} />{label}</button> })}</div>

        {step === 'feedback' && <div className="st-stack">
          {!feedback && <p className="st-muted">이 영상은 피드백 없이 편집용으로만 분석됐어요.</p>}
          {tempo.available && (tempo.delayedStart || tempo.firstThreeChars < 6) && <article className="st-ve-note"><strong>첫 3초</strong><p>{tempo.delayedStart ? `첫 말이 ${tempo.firstStart.toFixed(1)}초에 시작해요. 시청자는 3초 안에 넘길지 정하니, 앞부분을 잘라 바로 말로 시작해 보세요.` : '첫 3초에 나오는 말이 적어요. 무슨 영상인지 첫 마디로 바로 알려주면 덜 넘겨요.'}</p><button type="button" className="st-btn st-btn-sm" onClick={() => listen(0, Math.min(3.5, draft.duration))}><Play size={15} />첫 3초 보기</button></article>}
          {findings.map((f, i) => <article key={i} className="st-ve-finding">
            <div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{AREA[f.area]}</span>{f.start !== null && <button type="button" className="st-btn st-btn-sm" onClick={() => listen(f.start, f.end)}><Play size={15} />{timeLabel(f.start)} 부분 보기</button>}</div>
            <strong>{f.problem}</strong><p>{f.reason}</p>
            <div className="st-ve-example"><span>이렇게 바꿔 보세요</span>{f.example}</div>
          </article>)}
          {hookItems.filter(h => h.action !== 'remove').map(h => <article key={h.id} className="st-ve-finding"><div className="st-row" style={{ justifyContent: 'space-between' }}><span className="st-pill">{AREA[h.area]}</span><button type="button" className="st-btn st-btn-sm" onClick={() => listen(h.start, h.end)}><Play size={15} />{timeLabel(h.start)} 부분 보기</button></div><strong>“{h.quote}”</strong><p>{h.reason}</p></article>)}
          {suggestRemove.length > 0 && <article className="st-ve-note"><strong>빼도 되는 말 {suggestRemove.length}곳</strong><p>같은 말을 다시 하는 부분이에요. 문장 빼기에서 한 번에 뺄 수 있어요.</p><button type="button" className="st-btn st-btn-sm st-btn-primary" onClick={() => setStep('cut')}><Scissors size={15} />문장 빼기로</button></article>}
          {unchecked.length > 0 && <p className="st-muted st-small">{unchecked.join(' · ')}은(는) 이번 영상에서 확인하지 못했어요.</p>}
          <p className="st-muted st-small">조회수를 예측하는 점수가 아니라, 올리기 전에 완성도를 높이기 위한 참고 의견이에요.</p>
        </div>}

        {step === 'cut' && <div className="st-stack">
          <p className="st-muted">빼고 싶은 말을 누르면 그 부분이 영상에서 잘려요. 다시 누르면 되살아나요. 더 세밀하게 자르려면 아래 타임라인의 분할·자르기를 쓰세요.</p>
          <div className="st-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {suggestRemove.length > 0 && <button type="button" className="st-btn st-btn-sm st-btn-soft" onClick={applySuggestions}><Wand2 size={15} />훅ai 추천대로 반복된 말 빼기</button>}
            {cuts.length > 0 && <button type="button" className={`st-btn st-btn-sm${silenceOut ? ' st-btn-primary' : ''}`} onClick={toggleSilence}>{silenceOut ? <Check size={15} /> : <Scissors size={15} />}말 없는 부분 {cuts.length}곳 {silenceOut ? '빼는 중' : '빼기'}</button>}
            {(draft.clips.length > 1 || draft.clips[0]?.start > 0 || draft.clips[0]?.end < ms(draft.duration)) && <button type="button" className="st-btn st-btn-sm" onClick={() => edit({ clips: [{ id: newId('clip'), start: 0, end: ms(draft.duration) }] })}><RotateCcw size={15} />처음 영상으로 되돌리기</button>}
          </div>
          <ol className="st-ve-lines">{draft.subtitles.map(c => { const off = offIds.has(c.id); const hint = suggestRemove.some(s => overlaps(s, c))
            return <li key={c.id} className={`${off ? 'is-off' : ''}${cue?.id === c.id ? ' is-now' : ''}`}>
              <button type="button" className="st-ve-time" onClick={() => listen(c.start, c.end)} aria-label={`${timeLabel(c.start)} 부분 듣기`}><Play size={13} />{timeLabel(c.start)}</button>
              <span className="st-ve-text">{c.text}{hint && !off && <em>훅ai: 반복이라 빼도 돼요</em>}</span>
              <button type="button" className={`st-btn st-btn-sm${off ? '' : ' st-ve-cut'}`} onClick={() => toggleCue(c)}>{off ? '되살리기' : '빼기'}</button>
            </li> })}</ol>
        </div>}

        {step === 'subtitles' && <div className="st-stack">
          <div className="st-ve-styles">{Object.entries(SUBTITLE_PRESETS).map(([id, p]) => <button type="button" key={id} aria-pressed={draft.style.preset === id} onClick={() => edit(d => ({ style: { ...d.style, preset: id } }))}><span className={`st-ve-swatch st-ve-swatch-${id}`}><i>가나다</i></span>{p.label}</button>)}</div>
          <label className="st-ve-consent"><input type="checkbox" checked={draft.style.burnIn} onChange={e => edit(d => ({ style: { ...d.style, burnIn: e.target.checked } }))} />완성 영상에 자막을 입혀서 만들기</label>
          <div className="st-ve-tools">
            {plan?.id && <button type="button" className="st-btn st-btn-sm st-btn-soft" disabled={fixing} onClick={fixWithPlan}>{fixing ? <><LoaderCircle size={15} className="st-spin" />대본과 비교하는 중…</> : <><Wand2 size={15} />기획안 대본으로 오타 고치기</>}</button>}
            <button type="button" className="st-btn st-btn-sm" onClick={shorten}><Scissors size={15} />짧은 자막으로 나누기</button>
            <button type="button" className="st-btn st-btn-sm" onClick={addCue}><Plus size={15} />재생선 위치에 자막 추가</button>
          </div>
          <p className="st-muted st-small">자막을 누르면 시간 조정, 나누기, 합치기를 할 수 있어요. 잘라낸 부분의 자막은 완성 영상에 나오지 않아요.</p>
          <ol className="st-ve-lines">{draft.subtitles.map((c, i) => <CueRow key={c.id} c={c} i={i} off={offIds.has(c.id)} now={cue?.id === c.id} selected={selCue?.id === c.id} focus={Boolean(sel?.focus) && selCue?.id === c.id}
            next={draft.subtitles[i + 1]} words={words} time={time} onSelect={() => setSel({ kind: 'cue', id: c.id })} onListen={() => listen(c.start, c.end)}
            onText={text => setCue(c.id, { text })} onTime={(field, v) => setCueTime(c.id, field, v)} onSplit={(after, at) => splitCue(c, after, at)} onSplitHere={() => splitCueAt(c, time)}
            onMerge={() => mergeNext(c)} onDelete={() => { edit(d => ({ subtitles: d.subtitles.filter(v => v.id !== c.id) })); setSel(null) }} />)}</ol>
        </div>}

        {step === 'export' && <div className="st-stack">
          <div className="st-ve-summary">
            <div><span>영상 길이</span><strong>{timeLabel(draft.duration)} → {timeLabel(total)}</strong></div>
            <div><span>뺀 말</span><strong>{offIds.size}곳 · 조각 {draft.clips.length}개</strong></div>
            <div><span>자막</span><strong>{draft.style.burnIn ? SUBTITLE_PRESETS[draft.style.preset].label : '입히지 않음(파일만)'}</strong></div>
          </div>
          {problem && <div className="st-error" role="alert">{problem}. 고친 다음 영상을 만들 수 있어요.</div>}
          {busy ? <div className="st-ve-note"><strong><LoaderCircle size={16} className="st-spin" /> 영상을 만드는 중이에요</strong><p>1~3분 걸려요. 다른 화면을 봐도 계속 만들어져요.</p></div>
            : render?.status === 'failed' ? <div className="st-error" role="alert">{render.error?.message || '영상을 만들지 못했어요. 다시 시도해주세요.'}</div> : null}
          {(media.videoUrl || media.downloadUrl) && saveState === 'saved' && !busy && <>
            <a className="st-btn st-btn-primary st-btn-lg" href={media.videoUrl || media.downloadUrl} download><Download size={20} />완성 영상 받기</a>
            {media.videoUrl && media.downloadUrl && <a className="st-btn" href={media.downloadUrl} download><Download size={18} />영상·자막·원본 한꺼번에 받기 (압축 파일)</a>}
          </>}
          <button type="button" className={`st-btn st-btn-lg${media.downloadUrl ? '' : ' st-btn-primary'}`} disabled={!media.previewUrl || busy || Boolean(problem)} onClick={startRender}><Film size={20} />{media.downloadUrl ? '지금 편집으로 다시 만들기' : '완성 영상 만들기'}</button>
          <button type="button" className="st-btn" onClick={downloadSrt}><Captions size={18} />자막 파일(SRT)만 받기</button>
          <p className="st-muted st-small">완성 파일은 7일 동안 받을 수 있어요. 캡컷 같은 앱에서 더 다듬으려면 자막 파일을 함께 쓰세요.</p>
        </div>}
      </div>

      <section className="st-tl" aria-label="타임라인">
        <div className="st-tl-bar">
          <button type="button" className="st-btn st-btn-sm st-btn-primary st-tl-play" disabled={!media.previewUrl} onClick={toggle} aria-label={playing ? '멈춤' : '편집한 대로 재생'} title="재생·멈춤 (스페이스)">{playing ? <Pause size={17} /> : <Play size={17} />}</button>
          <span className="st-tl-clock">{clock(pos)} <span>/ {clock(total)}</span></span>
          <div className="st-tl-tools">
            <button type="button" className="st-btn st-btn-sm" disabled={!(selCue ? time > selCue.start && time < selCue.end : canSplitClip)} onClick={splitHere} title="재생선 위치에서 나누기 (⌘B)"><Scissors size={15} />분할</button>
            <button type="button" className="st-btn st-btn-sm" disabled={!canSplitClip} onClick={trimBefore} title="재생선 앞부분을 잘라내요"><ArrowLeftToLine size={15} />앞 자르기</button>
            <button type="button" className="st-btn st-btn-sm" disabled={!canSplitClip} onClick={trimAfter} title="재생선 뒷부분을 잘라내요"><ArrowRightToLine size={15} />뒤 자르기</button>
            <button type="button" className="st-btn st-btn-sm" disabled={!selClip && !selCue} onClick={deleteSelected} title="선택한 조각이나 자막 지우기 (Delete)"><Trash2 size={15} />삭제</button>
            <button type="button" className="st-btn st-btn-sm" disabled={!selClip} onClick={duplicate}><Copy size={15} />복제</button>
            <button type="button" className="st-btn st-btn-sm" onClick={addCue}><Plus size={15} />자막 추가</button>
          </div>
          <div className="st-tl-zoom">
            <button type="button" className="st-icon-btn" aria-label="타임라인 축소" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}><ZoomOut size={17} /></button>
            <button type="button" className="st-icon-btn" aria-label="타임라인 확대" disabled={zoom >= ZOOMS.at(-1)} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}><ZoomIn size={17} /></button>
          </div>
        </div>
        <div className="st-tl-scroll" ref={scroller} onPointerDown={scrub}>
          <div className="st-tl-inner" style={{ width: total * pps + PAD * 2 }}>
            <div className="st-tl-ruler">{ticks.map(t => <span key={t} style={{ left: PAD + t * pps }}>{tickStep < 1 ? clock(t) : timeLabel(t)}</span>)}</div>
            <div className="st-tl-track st-tl-video" aria-label="영상 트랙">{rows.map((c, i) => <div key={c.id} role="button" tabIndex={0} aria-label={`조각 ${i + 1}, ${timeLabel(c.duration)}`} aria-pressed={selClip?.id === c.id}
              className={`st-tl-clip${selClip?.id === c.id ? ' is-sel' : ''}`} style={{ left: PAD + c.offset * pps, width: Math.max(4, c.duration * pps) }} onPointerDown={e => pickClip(e, c)} onKeyDown={e => e.key === 'Enter' && setSel({ kind: 'clip', id: c.id })}>
              <span className="st-tl-film" aria-hidden="true">{film.frames.filter(f => f.t + film.step > c.start && f.t < c.end).map(f => <img key={f.t} src={f.url} alt="" style={{ left: (f.t - c.start) * pps, width: film.step * pps + 1 }} />)}</span>
              <b>{i + 1}</b><small>{clock(c.duration)}</small>
              {selClip?.id === c.id && <><i className="st-tl-grip is-start" aria-hidden="true" onPointerDown={e => dragEdge(e, 'clip', draft.clips[selIndex], 'start')} /><i className="st-tl-grip is-end" aria-hidden="true" onPointerDown={e => dragEdge(e, 'clip', draft.clips[selIndex], 'end')} /></>}
            </div>)}</div>
            <div className="st-tl-track st-tl-subs" aria-label="자막 트랙">{outCues.map((c, i) => <div key={`${c.id}-${i}`} role="button" tabIndex={0} aria-label={`자막: ${c.text}`} aria-pressed={selCue?.id === c.id}
              className={`st-tl-cue${selCue?.id === c.id ? ' is-sel' : ''}`} style={{ left: PAD + c.start * pps, width: Math.max(4, (c.end - c.start) * pps) }} onPointerDown={e => pickCue(e, c)} onKeyDown={e => e.key === 'Enter' && setSel({ kind: 'cue', id: c.id })}>
              <span>{c.text}</span>
              {selCue?.id === c.id && <><i className="st-tl-grip is-start" aria-hidden="true" onPointerDown={e => dragEdge(e, 'cue', selCue, 'start')} /><i className="st-tl-grip is-end" aria-hidden="true" onPointerDown={e => dragEdge(e, 'cue', selCue, 'end')} /></>}
            </div>)}</div>
            <div className="st-tl-head" style={{ left: PAD + pos * pps }} aria-hidden="true" />
          </div>
        </div>
        <p className="st-tl-help st-muted st-small">타임라인을 눌러 재생선을 옮기고, 조각이나 자막을 눌러 고르세요. 스페이스: 재생 · ⌘B: 분할 · Delete: 삭제 · ⌘Z: 되돌리기</p>
      </section>
    </div>
  </div>
}

// One subtitle in the list; the selected one opens its tools (timing, split between words, merge, delete).
function CueRow({ c, i, off, now, selected, focus, next, words, time, onSelect, onListen, onText, onTime, onSplit, onSplitHere, onMerge, onDelete }) {
  const ref = useRef(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [selected])
  const bounds = selected ? wordBoundaries(c, words) : []
  const tokens = captionWords(c.text)
  return <li ref={ref} className={`st-ve-cue${off ? ' is-off' : ''}${now ? ' is-now' : ''}${selected ? ' is-sel' : ''}`} onClick={selected ? undefined : onSelect}>
    <div className="st-ve-cue-main">
      <button type="button" className="st-ve-time" onClick={e => { e.stopPropagation(); onListen() }} aria-label={`${timeLabel(c.start)} 부분 듣기`}><Play size={13} />{timeLabel(c.start)}</button>
      <textarea className="st-ve-input" rows={1} value={c.text} maxLength={500} autoFocus={focus} onFocus={selected ? undefined : onSelect} onChange={e => onText(e.target.value)} aria-label={`자막 ${i + 1}`} />
    </div>
    {selected && <div className="st-ve-cue-tools">
      <div className="st-ve-times">
        <label>시작(초)<input type="number" step="0.05" min="0" value={Number(c.start.toFixed(2))} onChange={e => onTime('start', Number(e.target.value))} /></label>
        <label>끝(초)<input type="number" step="0.05" min="0" value={Number(c.end.toFixed(2))} onChange={e => onTime('end', Number(e.target.value))} /></label>
        <button type="button" className="st-btn st-btn-sm" onClick={() => onTime('start', time)}>재생선을 시작으로</button>
        <button type="button" className="st-btn st-btn-sm" onClick={() => onTime('end', time)}>재생선을 끝으로</button>
      </div>
      {tokens.length > 1 && <div className="st-ve-split" aria-label="나눌 곳 고르기">
        <span className="st-muted st-small">가위를 누르면 그 단어 뒤에서 나뉘어요</span>
        <div>{tokens.map((w, n) => { const b = bounds.find(x => x.after === n + 1); return <span key={n}>{w}{b && <button type="button" aria-label={`‘${w}’ 뒤에서 나누기`} onClick={() => onSplit(b.after, b.at)}><Scissors size={12} /></button>}</span> })}</div>
      </div>}
      <div className="st-ve-tools">
        <button type="button" className="st-btn st-btn-sm" disabled={tokens.length < 2 || !(time > c.start && time < c.end)} onClick={onSplitHere}><Scissors size={15} />재생선에서 나누기</button>
        <button type="button" className="st-btn st-btn-sm" disabled={!next} onClick={onMerge}><Merge size={15} />다음 자막과 합치기</button>
        <button type="button" className="st-btn st-btn-sm st-btn-danger" onClick={onDelete}><Trash2 size={15} />삭제</button>
      </div>
    </div>}
  </li>
}
