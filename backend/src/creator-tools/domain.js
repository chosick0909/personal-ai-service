import { createHash } from 'node:crypto'
import { AppError } from '../lib/errors.js'
import { CREATOR_CATEGORIES, REFERENCE_CATEGORIES } from './categories.js'

export const MAX_BYTES = 300 * 1024 * 1024
export const KINDS = ['reference-accounts', 'trend-keywords', 'import-link', 'media-analyze', 'media-render']
export function fail(code, message, statusCode = 400) {
  throw new AppError(message, { code, statusCode, exposeMessage: true })
}
export function textInput(value, name, min = 1, max = 500) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    fail('INVALID_INPUT', `${name}: ${min}~${max}자로 입력해주세요.`)
  }
  return value.normalize('NFC').trim()
}
export function uuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) fail('INVALID_ID', '잘못된 작업 ID입니다.')
  return value
}
export function username(value) {
  const name = String(value || '').replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9_.]{1,30}$/.test(name)) fail('INVALID_USERNAME', '계정 이름을 확인해주세요.')
  return name
}
export function stableHash(value) {
  const canonical = (item) => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function normalizeInstagramUrl(input) {
  let url
  try { url = new URL(input) } catch { fail('INVALID_LINK', '인스타그램 게시물 또는 릴스 링크를 입력해주세요.') }
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password) {
    fail('UNSUPPORTED_LINK', 'https 인스타그램 게시물·릴스 링크만 지원합니다.')
  }
  const match = url.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]{5,80})\/?$/)
  if (!match) fail('UNSUPPORTED_LINK', '프로필이 아닌 개별 영상 링크를 입력해주세요.')
  return `https://www.instagram.com/reel/${match[1]}/`
}
export function featureEnabled(kind, userId, env = process.env) {
  if (env.CREATOR_TOOLS_ENABLED !== 'true' || !KINDS.includes(kind)) return false
  if (!String(env.CREATOR_TOOLS_FEATURES || '').split(',').includes(kind)) return false
  const allowed = String(env.CREATOR_TOOLS_USER_IDS || '').split(',').map((x) => x.trim())
  if (allowed.includes(userId)) return true
  const percent = Math.min(100, Math.max(0, Number(env.CREATOR_TOOLS_ROLLOUT_PERCENT) || 0))
  return parseInt(stableHash(userId).slice(0, 8), 16) % 10000 < percent * 100
}
const REFERENCE_CHOICES = {
  faceVisibility: ['any', 'visible', 'hidden', 'mixed'],
  accountSize: ['any', '10k_50k', '50k_200k', 'over_200k'],
  contentLanguage: ['any', 'ko', 'en', 'ja'],
}
const TREND_CHOICES = {
  trendGoal: ['education', 'problem_solving', 'comparison', 'review', 'purchase', 'news'],
  audienceLevel: ['beginner', 'experienced', 'ready_to_buy'],
  keywordScope: ['broad', 'balanced', 'specific'],
  contentStructure: ['howto', 'checklist', 'mistakes', 'comparison', 'review', 'case_study'],
  contentLanguage: ['ko', 'en', 'ja'],
}
const choice = (body, key) => {
  const value = body[key] ?? 'any'
  if (!REFERENCE_CHOICES[key].includes(value)) fail('INVALID_FILTER', '추천 조건을 다시 선택해주세요.')
  return value
}
export function normalizeBrief(body, kind = 'trend-keywords') {
  const category = body.category || ''
  if (kind === 'reference-accounts') {
    if (category && !REFERENCE_CATEGORIES.includes(category)) fail('INVALID_CATEGORY', '카테고리를 다시 선택해주세요.')
    if (!category) fail('CATEGORY_REQUIRED', '카테고리를 선택해주세요.')
    return { category, faceVisibility: choice(body, 'faceVisibility'), accountSize: choice(body, 'accountSize'),
      contentLanguage: choice(body, 'contentLanguage'), region: 'GLOBAL' }
  }
  if (!category || !REFERENCE_CATEGORIES.includes(category)) fail('INVALID_CATEGORY', '카테고리를 선택해주세요.')
  const trendChoice = (key) => {
    const value = body[key]
    if (!TREND_CHOICES[key].includes(value)) fail('INVALID_FILTER', '키워드 조건을 다시 선택해주세요.')
    return value
  }
  return { category, trendGoal:trendChoice('trendGoal'), audienceLevel:trendChoice('audienceLevel'),
    keywordScope:trendChoice('keywordScope'), contentStructure:trendChoice('contentStructure'),
    contentLanguage:trendChoice('contentLanguage'), region:'GLOBAL' }
}
export function validateManifest(input, original, duration) {
  if (!input || !Array.isArray(input.cuts) || !Array.isArray(input.subtitles) || input.subtitles.length > 500 || input.cuts.length > 200) {
    fail('INVALID_MANIFEST', '컷 또는 자막 형식이 올바르지 않습니다.')
  }
  const cuts = input.cuts.map((cut) => {
    const source = original.cuts.find((item) => item.id === cut.id)
    if (!source || typeof cut.enabled !== 'boolean') fail('INVALID_CUT', '분석된 컷 후보만 선택할 수 있습니다.')
    return { ...source, enabled: cut.enabled }
  })
  if (new Set(cuts.map((cut) => cut.id)).size !== cuts.length || cuts.length !== original.cuts.length) fail('INVALID_CUT', '컷 후보가 중복되거나 누락되었습니다.')
  const ranges = cuts.filter((cut) => cut.enabled).sort((a, b) => a.start - b.start)
  let end = 0
  for (const cut of ranges) {
    if (cut.start < end || cut.start < 0 || cut.end <= cut.start || cut.end > duration) fail('INVALID_CUT', '컷 구간이 올바르지 않습니다.')
    if ((original.words || []).some((word) => word.start - 0.08 < cut.end && word.end + 0.08 > cut.start)) fail('SPEECH_CUT', '발화와 겹치는 컷은 적용할 수 없습니다.')
    end = cut.end
  }
  if (duration - ranges.reduce((n, r) => n + r.end - r.start, 0) < 0.5) fail('EMPTY_VIDEO', '남길 영상 구간이 필요합니다.')
  let lastEnd = 0
  const subtitles = input.subtitles.map((cue, index) => {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < lastEnd || cue.end <= cue.start || cue.end > duration + 0.02) {
      fail('INVALID_SUBTITLE', '자막 시간이 겹치거나 영상 범위를 벗어났습니다.')
    }
    lastEnd = cue.end
    return { id: `cue-${index}`, start: cue.start, end: Math.min(duration, cue.end), text: textInput(cue.text, '자막', 1, 500).replace(/\r/g, '').replace(/\n{2,}/g, '\n') }
  })
  let clips
  if (input.clips !== undefined) {
    if (!Array.isArray(input.clips) || !input.clips.length || input.clips.length > 100) fail('INVALID_CLIPS', '1~100개 클립을 남겨주세요.')
    clips = input.clips.map((clip) => {
      if (typeof clip.id !== 'string' || clip.id.length > 100 || !Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end > duration || clip.end - clip.start < 0.08) fail('INVALID_CLIPS', '클립 시간을 원본 범위 안에서 지정해주세요.')
      return { id: clip.id, start: clip.start, end: clip.end }
    })
    const length = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0)
    if (new Set(clips.map(c => c.id)).size !== clips.length || length < 0.5 || length > 300) fail('INVALID_CLIPS', '중복 ID 없이 총 0.5초~5분의 편집을 구성해주세요.')
  }
  return { cuts, subtitles, words: original.words || [], ...(clips ? { clips } : {}) }
}
export function keepRanges(duration, cuts) {
  let cursor = 0
  const kept = []
  for (const cut of cuts.filter((x) => x.enabled).sort((a, b) => a.start - b.start)) {
    if (cut.start > cursor) kept.push({ start: cursor, end: cut.start })
    cursor = cut.end
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration })
  return kept
}
export function retimeSubtitles(subtitles, cuts) {
  const removed = cuts.filter((x) => x.enabled)
  const time = (t) => t - removed.reduce((n, cut) => n + Math.max(0, Math.min(t, cut.end) - cut.start), 0)
  return subtitles.map((cue) => ({ ...cue, start: time(cue.start), end: time(cue.end) })).filter((cue) => cue.end - cue.start >= 0.02)
}
export function toSrt(subtitles) {
  const stamp = (seconds) => {
    const ms = Math.round(Math.max(0, seconds) * 1000)
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
  }
  return subtitles.map((cue, i) => `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n')
}
export function safeCutCandidates(silences, words, duration) {
  if (!words.length) return []
  return silences.filter((r) => r.end - r.start >= 1.2).map((r, i) => ({
    id: `silence-${i}`, start: Math.max(0, r.start + 0.15), end: Math.min(duration, r.end - 0.15),
    reason: '긴 침묵', enabled: false,
  })).filter((r) => r.end > r.start && !words.some((w) => w.start - 0.08 < r.end && w.end + 0.08 > r.start))
}

export function mediaUploadDisposition(row, file, now = Date.now()) {
  if (row.original_name !== file.filename || Number(row.declared_size) !== file.size || row.mime_type !== file.mimeType) {
    fail('IDEMPOTENCY_CONFLICT', '업로드 ID에 다른 파일이 연결되어 있습니다.', 409)
  }
  const expiresAt = Date.parse(row.original_expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다. 파일을 다시 선택해주세요.', 410)
  if (row.job_id) return 'resume'
  if (row.status !== 'uploading') fail('UPLOAD_CLOSED', '다시 업로드할 수 없는 작업입니다. 최근 작업에서 확인해주세요.', 409)
  return 'upload'
}

// Captions stay in source time; project each intersection into the ordered output.
export function projectSubtitles(subtitles, clips) {
  let offset = 0
  return clips.flatMap(clip => {
    const cues = subtitles.filter(cue => cue.end > clip.start && cue.start < clip.end).map(cue => ({
      ...cue, start: offset + Math.max(cue.start, clip.start) - clip.start,
      end: offset + Math.min(cue.end, clip.end) - clip.start,
    })).filter(cue => cue.end - cue.start >= 0.02)
    offset += clip.end - clip.start
    return cues
  })
}
