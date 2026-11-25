import { apiFetch, parseApiResponse, createApiError } from '../lib/api'
import { creatorRequest } from '../lib/creatorApi'

export const studio = {
  capabilities: () => creatorRequest('/creator-tools/capabilities'),
  reels: params => creatorRequest(`/creator-tools/success-reels?${params}`),
  reel: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}`),
  analyze: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/analysis`, { method: 'POST' }),
  playback: shortcode => creatorRequest(`/creator-tools/success-reels/${shortcode}/playback`, { method: 'POST' }),
  references: () => creatorRequest('/creator-tools/studio/references'),
  tagReference: (shortcode, tags) => creatorRequest(`/creator-tools/studio/references/${shortcode}`, { method: 'PATCH', body: { tags } }),
  memoReference: (shortcode, memo) => creatorRequest(`/creator-tools/studio/references/${shortcode}`, { method: 'PATCH', body: { memo } }),
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
  cancelStage: id => creatorRequest(`/creator-tools/studio/sessions/${id}/cancel`, { method: 'POST', body: {} }),
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
  ideaStart: (text, attachments = []) => creatorRequest('/creator-tools/studio/ideas/threads', { method: 'POST', body: { text, attachments } }),
  ideaThread: id => creatorRequest(`/creator-tools/studio/ideas/threads/${id}`),
  ideaChat: (id, text, attachments = []) => creatorRequest(`/creator-tools/studio/ideas/threads/${id}/chat`, { method: 'POST', body: { text, attachments } }),
  removeIdeaThread: id => creatorRequest(`/creator-tools/studio/ideas/threads/${id}`, { method: 'DELETE' }),
  saveIdea: (threadId, card) => creatorRequest('/creator-tools/studio/ideas/saved', { method: 'POST', body: { threadId, card } }),
  updateIdea: (id, body) => creatorRequest(`/creator-tools/studio/ideas/saved/${id}`, { method: 'PATCH', body }),
  removeIdea: id => creatorRequest(`/creator-tools/studio/ideas/saved/${id}`, { method: 'DELETE' }),
  planFromIdea: id => creatorRequest(`/creator-tools/studio/ideas/saved/${id}/plan`, { method: 'POST' }),
  // 캐러셀 만들기 (내부 전용): plans, the conversation with 훅ai, and the image library.
  carousels: () => creatorRequest('/creator-tools/studio/carousels'),
  createCarousel: body => creatorRequest('/creator-tools/studio/carousels', { method: 'POST', body }),
  carousel: id => creatorRequest(`/creator-tools/studio/carousels/${id}`),
  patchCarousel: (id, body) => creatorRequest(`/creator-tools/studio/carousels/${id}`, { method: 'PATCH', body }),
  removeCarousel: id => creatorRequest(`/creator-tools/studio/carousels/${id}`, { method: 'DELETE' }),
  carouselStage: (id, stage, regenerate = false) => creatorRequest(`/creator-tools/studio/carousels/${id}/stage`, { method: 'POST', body: { stage, regenerate } }),
  cancelCarouselStage: id => creatorRequest(`/creator-tools/studio/carousels/${id}/cancel`, { method: 'POST', body: {} }),
  carouselChat: (id, text) => creatorRequest(`/creator-tools/studio/carousels/${id}/chat`, { method: 'POST', body: { text } }),
  applyCarousel: (id, messageId) => creatorRequest(`/creator-tools/studio/carousels/${id}/apply`, { method: 'POST', body: { messageId } }),
  saveCarouselDesign: design => creatorRequest('/creator-tools/studio/carousel-design', { method: 'PUT', body: design }),
  images: () => creatorRequest('/creator-tools/studio/images'),
  removeImage: id => creatorRequest(`/creator-tools/studio/images/${id}`, { method: 'DELETE' }),
  searchStock: ({ q, orientation, page = 1 }) => creatorRequest(`/creator-tools/studio/images/stock?${new URLSearchParams({ q, orientation, page: String(page) })}`),
  pickStock: id => creatorRequest('/creator-tools/studio/images/stock', { method: 'POST', body: { id } }),
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
export const STAGES = [['topic', '주제'], ['thumbnail', '썸네일'], ['script', '첫 문장·대본'], ['filming', '촬영·편집'], ['caption', '캡션'], ['done', '완성']]

// Reads picked files into text; files that could not be read come back with their error.
export async function readMaterials(path, picked) {
  const form = new FormData(); picked.slice(0, 5).forEach(f => form.append('files', f))
  const response = await apiFetch(path, { method: 'POST', body: form, timeoutMs: 180000 })
  const payload = await parseApiResponse(response)
  if (!response.ok) throw createApiError(response, payload, '파일을 읽지 못했어요.')
  return { ready: payload.items.filter(i => i.status === 'ready').map(i => ({ name: i.name, content: i.content })), failed: payload.items.filter(i => i.status !== 'ready') }
}

// Image calls take longer than the usual request limit (an AI image is written, drawn, fetched and stored in one go).
async function slowRequest(path, options, fallback) {
  const response = await apiFetch(`/api${path}`, { ...options, timeoutMs: 300000 })
  const payload = await parseApiResponse(response)
  if (!response.ok) throw createApiError(response, payload, fallback)
  return payload
}
export const draftSheet = id => slowRequest(`/creator-tools/studio/carousels/${id}/sheet/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, '정리할 글을 만들지 못했어요.')
export const makeSheet = (id, sheet) => slowRequest(`/creator-tools/studio/carousels/${id}/sheet`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sheet }) }, '총정리 이미지를 만들지 못했어요.')
export const generateImage = body => slowRequest('/creator-tools/studio/images/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, '이미지를 만들지 못했어요.')
// A photo is shrunk in the browser before it is sent (long side 2,160px, plus a small preview): phone originals are
// several megabytes each, and a slide is only 1,080px wide.
const shrink = (bitmap, long, quality) => { const scale = Math.min(1, long / Math.max(bitmap.width, bitmap.height)); const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(blob => resolve({ blob, width: canvas.width, height: canvas.height }), 'image/jpeg', quality)) }
export async function uploadImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) throw new Error('이 파일은 이미지로 읽지 못했어요. JPG나 PNG로 올려주세요.')
  const [full, thumb] = await Promise.all([shrink(bitmap, 2160, 0.88), shrink(bitmap, 480, 0.8)])
  const form = new FormData()
  form.append('image', full.blob, 'image.jpg'); form.append('thumb', thumb.blob, 'thumb.jpg'); form.append('width', String(full.width)); form.append('height', String(full.height))
  return slowRequest('/creator-tools/studio/images', { method: 'POST', body: form }, '이미지를 올리지 못했어요.')
}
export const CAROUSEL_STAGES = [['cover', '표지 제목'], ['body', '본문 기획'], ['slides', '슬라이드 나누기'], ['design', '디자인'], ['caption', '캡션'], ['done', '완성']]
