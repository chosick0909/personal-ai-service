// Read-only observations of subtitle timing, not actual silence or viewer retention.
export function diagnoseTempo(subtitles, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) return { available: false, reason: 'invalid_duration' }
  if (!Array.isArray(subtitles)) return { available: false, reason: 'no_subtitles' }
  const cues = subtitles.flatMap(cue => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start || typeof cue.text !== 'string') return []
    const start = Math.max(0, Math.min(durationSeconds, cue.start)), end = Math.max(0, Math.min(durationSeconds, cue.end))
    const chars = Array.from(cue.text.replace(/\s/gu, '')).length
    return end > start && chars ? [{ start, end, chars: chars * (end-start) / (cue.end-cue.start) }] : []
  }).sort((a,b) => a.start-b.start || a.end-b.end)
  if (!cues.length) return { available: false, reason: 'no_subtitles' }
  const intervals = []
  for (const cue of cues) {
    const previous = intervals.at(-1)
    if (previous && cue.start <= previous.end) previous.end = Math.max(previous.end, cue.end)
    else intervals.push({ start: cue.start, end: cue.end })
  }
  const charsBetween = (start,end) => cues.reduce((sum,cue) => sum + cue.chars * Math.max(0, Math.min(end,cue.end)-Math.max(start,cue.start)) / (cue.end-cue.start), 0)
  const gaps = intervals.slice(1).flatMap((range,i) => range.start-intervals[i].end >= .7-1e-9 ? [{start:intervals[i].end,end:range.start}] : [])
    .sort((a,b) => (b.end-b.start)-(a.end-a.start) || a.start-b.start).slice(0,5)
  const windows = []
  for (let start=0; start<durationSeconds; start+=5) {
    const end = Math.min(durationSeconds,start+5)
    windows.push({ start, end, charsPerSecond:charsBetween(start,end)/(end-start) })
  }
  const rates = windows.map(window => window.charsPerSecond).sort((a,b)=>a-b), middle = Math.floor(rates.length/2)
  const median = rates.length%2 ? rates[middle] : (rates[middle-1]+rates[middle])/2
  const slow = median > 0 ? windows.filter(window=>window.charsPerSecond < median*.5).sort((a,b)=>a.charsPerSecond-b.charsPerSecond || a.start-b.start).slice(0,3) : []
  const spokenSeconds = intervals.reduce((sum,range)=>sum+range.end-range.start,0)
  return { available:true, firstStart:cues[0].start, delayedStart:cues[0].start>=.8,
    firstThreeChars:charsBetween(0,Math.min(3,durationSeconds)), gaps, slow,
    averageCharsPerSecond:cues.reduce((sum,cue)=>sum+cue.chars,0)/spokenSeconds }
}
