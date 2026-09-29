import { getSupabaseAdmin } from '../lib/supabase.js'
import { fail, stableHash } from './domain.js'
import { presentReferencePlanning } from './reference-planning.js'

export const BUCKET = 'creator-media'
export const OUTPUT_BUCKET = 'creator-exports'
export function database() {
  const db = getSupabaseAdmin()
  if (!db) fail('TOOLS_NOT_CONFIGURED', '새 도구의 서버 연결이 준비되지 않았습니다.', 503)
  return db
}
export async function query(request) {
  const { data, error } = await request
  if (error) {
    if (String(error.message).includes('IDEMPOTENCY_CONFLICT')) fail('IDEMPOTENCY_CONFLICT', '같은 요청 ID로 내용을 바꿀 수 없습니다.', 409)
    if (/DAILY_JOB_LIMIT|ACTIVE_JOB_LIMIT/.test(error.message)) fail('TOOLS_LIMIT', '진행 중인 작업 또는 오늘의 도구 사용 한도를 확인해주세요.', 429)
    if (String(error.message).includes('MONTHLY_REFERENCE_LIMIT')) fail('MONTHLY_REFERENCE_LIMIT', '이번 달 분석 한도를 확인해주세요. 진행 중인 링크 분석도 한도에 포함됩니다.', 429)
    throw error
  }
  return data
}
export async function ownedJob(db, id, userId, kind) {
  let q = db.from('creator_jobs').select('*').eq('id', id).eq('user_id', userId)
  if (kind) q = q.eq('kind', kind)
  const row = await query(q.maybeSingle())
  if (!row) fail('JOB_NOT_FOUND', '작업을 찾을 수 없습니다.', 404)
  return row
}
export async function ownedMedia(db, id, userId) {
  const row = await query(db.from('creator_media_projects').select('*').eq('id', id).eq('user_id', userId).maybeSingle())
  if (!row) fail('MEDIA_NOT_FOUND', '영상을 찾을 수 없습니다.', 404)
  return row
}
export async function createJob(db, { userId, accountId = null, kind, key, input, hashInput = input }) {
  return query(db.rpc('creator_create_job', {
    p_user: userId, p_account: accountId, p_kind: kind, p_key: key,
    p_hash: stableHash(hashInput), p_input: input,
  }))
}
export async function updateJob(db, id, patch) {
  return query(db.from('creator_jobs').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id).in('status', ['queued', 'running']).select().maybeSingle())
}
// Never expose raw checkpoints: receipts and provider data can contain private URLs.
// This checkpoint exists only after translation and length validation have passed.
function visibleLinkTranscript(row) {
  if (row.kind !== 'import-link' || !['queued', 'running', 'failed', 'cancelled'].includes(row.status)) return null
  const preview = row.checkpoint?.referenceTranscriptV1
  if (!preview || !['originalTranscript', 'translatedTranscript'].every(key =>
    typeof preview[key] === 'string' && preview[key].trim().length >= 2 && preview[key].length <= 20000)) return null
  if (typeof preview.sourceLanguage !== 'string' || typeof preview.extractedAt !== 'string') return null
  return { sourceLanguage: preview.sourceLanguage, originalTranscript: preview.originalTranscript,
    translatedTranscript: preview.translatedTranscript, extractedAt: preview.extractedAt,
    analysisStatus: ['queued', 'running'].includes(row.status) ? 'pending' : 'unavailable' }
}
export function publicJob(row) {
  const result = row.kind === 'reference-accounts' ? presentReferencePlanning(row.result, row.input?.category) : row.result
  return { id: row.id, accountId: row.account_id, kind: row.kind, purpose: row.input?.feedbackCaption !== undefined ? 'feedback' : null, status: row.status, stage: row.stage, result: result ?? visibleLinkTranscript(row),
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, deadlineAt: row.deadline_at }
}
export async function signedDownload(db, path, bucket = BUCKET) {
  if (!path) return null
  const result = await query(db.storage.from(bucket).createSignedUrl(path, 300))
  return result.signedUrl
}
