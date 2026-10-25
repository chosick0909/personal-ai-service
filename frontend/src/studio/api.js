import { creatorRequest } from '../lib/creatorApi'

export const studio = {
  capabilities: () => creatorRequest('/creator-tools/capabilities'),
  reels: params => creatorRequest(`/creator-tools/success-reels?${params}`),
  reel: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}`),
  analyze: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/analysis`, { method: 'POST' }),
  playback: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/playback`, { method: 'POST' }),
  references: () => creatorRequest('/creator-tools/studio/references'),
  tagReference: (shortcode, tags) => creatorRequest(`/creator-tools/studio/references/${shortcode}`, { method: 'PATCH', body: { tags } }),
  removeReference: shortcode => creatorRequest(`/creator-tools/studio/references/${shortcode}`, { method: 'DELETE' }),
  sessions: () => creatorRequest('/creator-tools/studio/sessions'),
  createSession: body => creatorRequest('/creator-tools/studio/sessions', { method: 'POST', body }),
  session: id => creatorRequest(`/creator-tools/studio/sessions/${id}`),
  patchSession: (id, body) => creatorRequest(`/creator-tools/studio/sessions/${id}`, { method: 'PATCH', body }),
  removeSession: id => creatorRequest(`/creator-tools/studio/sessions/${id}`, { method: 'DELETE' }),
  setTopic: (id, topic) => creatorRequest(`/creator-tools/studio/sessions/${id}/topic`, { method: 'POST', body: { topic } }),
  stage: (id, stage, regenerate = false) => creatorRequest(`/creator-tools/studio/sessions/${id}/stage`, { method: 'POST', body: { stage, regenerate } }),
  chat: (id, text) => creatorRequest(`/creator-tools/studio/sessions/${id}/chat`, { method: 'POST', body: { text } }),
  apply: (id, messageId) => creatorRequest(`/creator-tools/studio/sessions/${id}/apply`, { method: 'POST', body: { messageId } }),
  formulas: () => creatorRequest('/creator-tools/studio/formulas'),
  saveFormula: body => creatorRequest('/creator-tools/studio/formulas', { method: 'POST', body }),
  removeFormula: id => creatorRequest(`/creator-tools/studio/formulas/${id}`, { method: 'DELETE' }),
  library: () => creatorRequest('/creator-tools/studio/library'),
  style: () => creatorRequest('/creator-tools/studio/style'),
  saveStyle: body => creatorRequest('/creator-tools/studio/style', { method: 'PUT', body }),
  removeTopic: id => creatorRequest(`/creator-tools/studio/topics/${id}`, { method: 'DELETE' }),
}

export function compactCount(value) {
  if (!Number.isFinite(value)) return '-'
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만`
  return value.toLocaleString('ko-KR')
}
export const day = value => value ? new Date(value).toISOString().slice(0, 10) : ''
export const when = value => value ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
export const SLOT_LABELS = { hook: '첫 문장', structure: '전개', filming: '촬영', editing: '편집', caption: '캡션' }
export const PART_LABELS = { hook: '첫 문장', body: '본문', cta: '마무리' }
export const STAGES = [['topic', '주제'], ['thumbnail', '썸네일'], ['hook', '첫 문장'], ['script', '대본'], ['filming', '촬영·편집'], ['caption', '캡션'], ['done', '완성']]
