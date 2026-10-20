// One caption contract for automatic grouping, preview, manual splitting and export.
export const SUBTITLE_PRESETS = {
  outline: { label: '또렷한 흰 자막', size: .105, y: .60, outline: .003, box: false, italic: false },
  box: { label: '흰 박스 자막', size: .07, y: .34, outline: 0, box: true, italic: true },
  compact: { label: '작은 흰 자막', size: .06, y: .61, outline: .0025, box: false, italic: false },
}
export const captionWords = text => String(text || '').trim().match(/\S+/gu) || []
const length = text => Array.from(text).length
const normalized = text => text.normalize('NFC').replace(/\s/gu, '')

// Only use ASR timestamps when the entire source text aligns. Never replace the
// transcript with token text: ASR word arrays sometimes omit or alter words.
export function wordBoundaries(cue, timedWords = []) {
  const tokens = captionWords(cue.text)
  if (tokens.length < 2) return []
  const words = timedWords.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.start >= cue.start - .02 && w.end <= cue.end + .02)
  const aligned = words.length && words.every((w,i)=>!i||(w.start>=words[i-1].start&&w.end>=words[i-1].end)) && normalized(words.map(w => w.word || w.text || '').join('')) === normalized(tokens.join(''))
  const full = tokens.reduce((n, t) => n + length(normalized(t)), 0)
  let cursor = 0
  return tokens.slice(0, -1).map((token, index) => {
    cursor += length(normalized(token))
    let at = cue.start + (cue.end - cue.start) * cursor / full
    let exact = false
    if (aligned) {
      let count = 0
      for (let i = 0; i < words.length - 1; i++) {
        count += length(normalized(words[i].word || words[i].text || ''))
        if (count === cursor) { at = Math.max(words[i].end, Math.min(words[i+1].start, (words[i].end + words[i+1].start) / 2)); exact = true; break }
      }
    }
    return { after: index + 1, at, exact, left: tokens.slice(0,index+1).join(' '), right: tokens.slice(index+1).join(' ') }
  }).filter(b => b.at > cue.start && b.at < cue.end)
}
export function splitSubtitle(cue, after, at, newId) {
  const words = captionWords(cue.text)
  if (!Number.isInteger(after) || after < 1 || after >= words.length || !Number.isFinite(at) || at - cue.start < .08 - 1e-8 || cue.end - at < .08 - 1e-8) return null
  return [{ ...cue, end: at, text: words.slice(0, after).join(' ') }, { ...cue, id: newId, start: at, text: words.slice(after).join(' ') }]
}
export function groupSubtitles(segments, timedWords = []) {
  const cues = segments.flatMap(cue => {
    const words = captionWords(cue.text), boundaries = wordBoundaries(cue, timedWords)
    if (words.length < 2) return [{ ...cue }]
    const times = new Map(boundaries.map(b => [b.after, b.at]))
    const result = []; let first = 0, start = cue.start
    for (let end = 1; end <= words.length; end++) {
      const next = words.slice(first, end + 1).join(' ')
      const at = end === words.length ? cue.end : times.get(end)
      const sentenceEnd = /[.!?。！？]$/u.test(words[end-1])
      const shouldEnd = end === words.length || end-first >= 3 || length(next) > 14 || at-start >= 2.4 || sentenceEnd
      if (!shouldEnd || !Number.isFinite(at) || at-start < .08 || (cue.end-at > 0 && cue.end-at < .08)) continue
      result.push({ id: `${cue.id}-${result.length}`, start, end: at, text: words.slice(first,end).join(' ') }); first=end; start=at
    }
    // Very fast speech must never silently lose its final words.
    if (first < words.length) {
      if (result.length) { result.at(-1).text += ` ${words.slice(first).join(' ')}`; result.at(-1).end = cue.end }
      else result.push({ ...cue })
    }
    return result
  })
  // Keep the existing storage contract without dropping text on dense 5min videos.
  while (cues.length > 500) {
    let index = 0
    for (let i=1;i<cues.length-1;i++) if (cues[i+1].end-cues[i].start < cues[index+1].end-cues[index].start) index=i
    const a=cues[index], b=cues[index+1]
    cues.splice(index,2,{...a,end:b.end,text:`${a.text} ${b.text}`})
  }
  return cues
}
const units = text => Array.from(text).reduce((n,c)=>n+(/\s/u.test(c)?.32:/[\u0000-\u00ff]/u.test(c)?.58:1),0)
export function captionLayout(text, width, preset = 'outline') {
  const style = SUBTITLE_PRESETS[preset] || SUBTITLE_PRESETS.outline
  const lines = [], words = captionWords(text); let current = ''
  const size = width * style.size, maxWidth = width * .86
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (current && units(next)*size > maxWidth) { lines.push(current); current=word } else current=next
  }
  if (current) lines.push(current)
  // Single long words are scaled, never sliced. Manual long captions also fit.
  const fontSize = Math.min(size, maxWidth / Math.max(1,...lines.map(units)), width * .30 / Math.max(1,lines.length) / 1.25)
  return { ...style, fontSize, text: lines.join('\n') }
}
