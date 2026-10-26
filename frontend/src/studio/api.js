import { creatorRequest } from '../lib/creatorApi'

export const studio = {
  capabilities: () => creatorRequest('/creator-tools/capabilities'),
  reels: params => creatorRequest(`/creator-tools/success-reels?${params}`),
  reel: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}`),
  analyze: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/analysis`, { method: 'POST' }),
  playback: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/playback`, { method: 'POST' }),
  references: () => creatorRequest('/creator-tools/studio/references'),
  tagReference: (shortcode, tags) => creatorRequest(`/creator-tools/studio/references/${shortcode}`, { method: 'PATCH', body: { tags } }),
  addLink: url => creatorRequest('/creator-tools/studio/references/link', { method: 'POST', body: { url } }),
  addText: (title, text) => creatorRequest('/creator-tools/studio/references/text', { method: 'POST', body: { title, text } }),
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
  // 주제 찾기: conversations about the topic only, and the 주제 보관함.
  ideas: () => creatorRequest('/creator-tools/studio/ideas'),
  ideaStart: text => creatorRequest('/creator-tools/studio/ideas/threads', { method: 'POST', body: { text } }),
  ideaThread: id => creatorRequest(`/creator-tools/studio/ideas/threads/${id}`),
  ideaChat: (id, text) => creatorRequest(`/creator-tools/studio/ideas/threads/${id}/chat`, { method: 'POST', body: { text } }),
  removeIdeaThread: id => creatorRequest(`/creator-tools/studio/ideas/threads/${id}`, { method: 'DELETE' }),
  saveIdea: (threadId, card) => creatorRequest('/creator-tools/studio/ideas/saved', { method: 'POST', body: { threadId, card } }),
  updateIdea: (id, body) => creatorRequest(`/creator-tools/studio/ideas/saved/${id}`, { method: 'PATCH', body }),
  removeIdea: id => creatorRequest(`/creator-tools/studio/ideas/saved/${id}`, { method: 'DELETE' }),
  planFromIdea: id => creatorRequest(`/creator-tools/studio/ideas/saved/${id}/plan`, { method: 'POST' }),
  // 영상 편집: the existing media pipeline (upload → analyze → edit manifest → render), used in one-pass studio mode.
  jobs: () => creatorRequest('/creator-tools/jobs'),
  job: id => creatorRequest(`/creator-tools/jobs/${id}`),
  createMedia: body => creatorRequest('/media-projects', { method: 'POST', body }),
  analyzeMedia: (id, body) => creatorRequest(`/media-projects/${id}/analyze`, { method: 'POST', body: { ...body, studio: true, rightsConfirmed: true } }),
  media: id => creatorRequest(`/media-projects/${id}`),
  saveMedia: (id, revision, manifest) => creatorRequest(`/media-projects/${id}/edit-manifest`, { method: 'PATCH', body: { revision, manifest } }),
  renderMedia: (id, revision) => creatorRequest(`/media-projects/${id}/render`, { method: 'POST', body: { confirmed: true, revision } }),
  fixSubtitles: (id, planId) => creatorRequest(`/creator-tools/studio/media/${id}/fix-subtitles`, { method: 'POST', body: { planId } }),
}

export function compactCount(value) {
  if (!Number.isFinite(value)) return '-'
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}억`
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}만`
  return value.toLocaleString('ko-KR')
}
export const day = value => value ? new Date(value).toISOString().slice(0, 10) : ''
export const when = value => value ? new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
export const SLOT_LABELS = { hook: '첫 문장', structure: '전개', filming: '촬영/편집', caption: '캡션' }
export const PART_LABELS = { hook: '첫 문장', body: '본문', cta: '마무리' }
export const STAGES = [['topic', '주제'], ['thumbnail', '썸네일'], ['hook', '첫 문장'], ['script', '대본'], ['filming', '촬영·편집'], ['caption', '캡션'], ['done', '완성']]
