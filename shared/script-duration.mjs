// One estimate for planning, copilot checks and UI. This is a reading-time estimate,
// not measured speech; natural pauses and the speaker's pace can vary.
export const TOPIC_DURATION = Object.freeze({ min: 30, targetMax: 50, recommendedMax: 60 })
export const MIN_SCRIPT_SECONDS = 10
export const MAX_SCRIPT_SECONDS = 999
export function scriptText(sections = {}) {
  return ['hook', 'body', 'cta'].map((key) => String(sections[key] || '')).filter(Boolean).join('\n')
}
export function spokenCharacterCount(text = '') {
  return String(text).replace(/[\s.,!?。！？·~"'“”‘’()[\]{}:;\-–—]/g, '').length
}
export function estimateScriptSeconds(input = '') {
  const text = typeof input === 'object' ? scriptText(input) : String(input || '')
  if (!text.trim()) return 0
  const sentences = text.trim().split(/(?<=[.!?。！？])\s+|\n+/).filter((part) => part.trim()).length
  return Math.round((spokenCharacterCount(text) / 4.5 + sentences * 0.3) * 10) / 10
}
export function durationCharacterRange(seconds) {
  const max = Math.round(Math.max(1, seconds - 2) * 4.5)
  return { min: Math.min(Math.round(seconds * 3.8), Math.floor(max * 0.9)), max }
}
