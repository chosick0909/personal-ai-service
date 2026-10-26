export { estimateScriptSeconds, estimateLineSeconds } from '../../../shared/script-duration.mjs'
export const SCRIPT_KEYS = ['hook', 'body', 'cta']

// Preserve wording; only add visual sentence breaks. Intl avoids splitting decimal
// numbers, abbreviations and URLs at every period.
export function formatScriptText(value = '') {
  const paragraphs = String(value || '').trim().split(/\n+/).filter((part) => part.trim())
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('ko', { granularity: 'sentence' }) : null
  return paragraphs.flatMap((paragraph) => segmenter
    ? [...segmenter.segment(paragraph)].map(({ segment }) => segment.trim())
    : paragraph.split(/(?<=[.!?。！？])\s+(?=[^\d])/).map((part) => part.trim()),
  ).filter(Boolean).join('\n\n')
}
export function formatScriptSections(sections = {}) {
  return SCRIPT_KEYS.map((key) => formatScriptText(sections[key])).filter(Boolean).join('\n\n')
}

// Keep hidden legacy boundaries for API/storage compatibility while editing one
// continuous text. Map boundaries through the text replacement, then snap to a
// sentence/line boundary. This never infers product terms or user intent.
export function reconcileScriptSections(previous = {}, before = '', after = '') {
  const text = String(after || '')
  let prefix = 0
  while (prefix < before.length && prefix < text.length && before[prefix] === text[prefix]) prefix++
  let oldEnd = before.length
  let newEnd = text.length
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd-- }
  const characterBoundaries = [String(previous.hook || '').replace(/\s/g, '').length,
    (String(previous.hook || '') + String(previous.body || '')).replace(/\s/g, '').length]
  const oldBoundaries = characterBoundaries.map((count) => {
    if (!count) return 0
    let seen = 0
    for (let i = 0; i < before.length; i++) {
      if (!/\s/.test(before[i]) && ++seen === count) return i + 1
    }
    return before.length
  })
  const mapOffset = (offset) => offset <= prefix ? offset : offset >= oldEnd
    ? offset + newEnd - oldEnd
    : prefix + Math.round((offset - prefix) * (newEnd - prefix) / Math.max(1, oldEnd - prefix))
  const candidates = [0, text.length]
  for (const match of text.matchAll(/\n+|(?<=[.!?。！？])\s+/g)) candidates.push(match.index)
  const nearest = (offset, minimum) => candidates.filter((point) => point >= minimum)
    .reduce((best, point) => Math.abs(point - offset) < Math.abs(best - offset) ? point : best, text.length)
  const first = nearest(mapOffset(oldBoundaries[0]), 0)
  const second = nearest(mapOffset(oldBoundaries[1]), first)
  // Blank lines delimit legacy sections. Keep within-section line breaks single,
  // so saving/reopening cannot accidentally move a body paragraph into CTA.
  const normalize = (part) => part.trim().replace(/\n\s*\n/g, '\n')
  return { hook: normalize(text.slice(0, first)), body: normalize(text.slice(first, second)), cta: normalize(text.slice(second)) }
}
