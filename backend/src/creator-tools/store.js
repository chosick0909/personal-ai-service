import { getSupabaseAdmin } from '../lib/supabase.js'
import { fail, stableHash } from './domain.js'

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
export function publicJob(row) {
  return { id: row.id, accountId: row.account_id, kind: row.kind, purpose: row.input?.feedbackCaption !== undefined ? 'feedback' : null, status: row.status, stage: row.stage, result: row.result,
    error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
    createdAt: row.created_at, updatedAt: row.updated_at, deadlineAt: row.deadline_at }
}
export async function signedDownload(db, path, bucket = BUCKET) {
  if (!path) return null
  const result = await query(db.storage.from(bucket).createSignedUrl(path, 300))
  return result.signedUrl
}
