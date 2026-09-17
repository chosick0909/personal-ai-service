export const MIN_CLIP = 0.08
export const durationOf = clips => clips.reduce((sum, clip) => sum + clip.end - clip.start, 0)
export function timelineRows(clips) {
  let offset = 0
  return clips.map(clip => {
    const row = { ...clip, offset, duration: clip.end - clip.start }
    offset += row.duration
    return row
  })
}
export function locateTime(clips, time) {
  const rows = timelineRows(clips)
  const clamped = Math.max(0, Math.min(Number(time) || 0, durationOf(clips)))
  const index = rows.findIndex((row, i) => clamped < row.offset + row.duration || i === rows.length - 1)
  if (index < 0) return null
  const row = rows[index]
  return { ...row, index, sourceTime: row.start + clamped - row.offset, time: clamped }
}
export function splitClip(clips, id, sourceTime, newId) {
  return clips.flatMap(clip => {
    if (clip.id !== id || sourceTime - clip.start < MIN_CLIP || clip.end - sourceTime < MIN_CLIP) return [clip]
    return [{ ...clip, end: sourceTime }, { ...clip, id: newId, start: sourceTime }]
  })
}
export function removeRange(clips, from, to, makeId) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return clips
  return timelineRows(clips).flatMap(({ offset, duration, ...clip }) => {
    if (to <= offset || from >= offset + duration) return [clip]
    const leftEnd = clip.start + Math.max(0, from - offset)
    const rightStart = clip.start + Math.min(duration, to - offset)
    const result = []
    if (leftEnd - clip.start >= MIN_CLIP) result.push({ ...clip, end: leftEnd })
    if (clip.end - rightStart >= MIN_CLIP) result.push({ ...clip, id: result.length ? makeId() : clip.id, start: rightStart })
    return result
  })
}
export function projectCaptions(clips, captions) {
  return timelineRows(clips).flatMap(clip => captions.filter(cue => cue.assetId === clip.assetId && cue.end > clip.start && cue.start < clip.end).map(cue => ({
    ...cue,
    start: clip.offset + Math.max(cue.start, clip.start) - clip.start,
    end: clip.offset + Math.min(cue.end, clip.end) - clip.start,
  })))
}
export function timeLabel(value, milliseconds = false) {
  const ms = Math.max(0, Math.round((Number(value) || 0) * 1000))
  const seconds = Math.floor(ms / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${milliseconds ? `.${String(ms % 1000).padStart(3, '0')}` : ''}`
}
export function toSrt(cues) {
  const stamp = value => {
    const ms = Math.max(0, Math.round(value * 1000))
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
  }
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n')
}
export function editHistory(state, action) {
  if (action.type === 'reset') return { past: [], present: action.project, future: [] }
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), present: state.past.at(-1), future: [state.present, ...state.future] }
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
  if (action.type === 'edit') return { past: [...state.past.slice(-49), state.present], present: action.project, future: [] }
  return state
}
