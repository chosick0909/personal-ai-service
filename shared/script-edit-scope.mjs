// Storage slots are not editing semantics. Old whole-script/body-only records
// need a logical beginning/middle/end before a later 'first/last sentence' edit.
// This view never writes the saved original and never changes the text itself.
export function scriptEditingView(sections = {}) {
  const result = Object.fromEntries(['hook','body','cta'].map(key => [key, String(sections[key] || '')]))
  if (result.hook.trim() || result.cta.trim() || !result.body.trim()) return result
  const text = result.body
  const sentences = [...new Intl.Segmenter('ko', {granularity:'sentence'}).segment(text)]
    .map(part => part.segment).filter(part => part.trim())
  if (sentences.length < 2) return result
  return {
    hook: sentences[0].trim(),
    body: sentences.slice(1,-1).join('').trim(),
    cta: sentences.at(-1).trim(),
  }
}
