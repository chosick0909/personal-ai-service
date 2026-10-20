import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { AppError, asyncHandler } from './errors.js'
import { getSupabaseAdmin } from './supabase.js'
import { resolveRequestAccount } from './accounts.js'
import { assertEntitlementAccess } from './entitlements.js'

const COLUMNS = 'id,account_id,project_id,kind,title,input,result,edited_caption,version,created_at,updated_at'
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
function fail(message, code = 'INVALID_TOOL_HISTORY', statusCode = 400) {
  throw new AppError(message, { code, statusCode, exposeMessage: true })
}

export function validateToolHistory(body = {}) {
  if (!body || !isUuid(body.id) || !['caption', 'thumbnail'].includes(body.kind)) {
    fail('저장할 도구 내역을 확인해주세요.')
  }
  if (!body.input || typeof body.input.topic !== 'string' || !body.input.topic.trim()) {
    fail('주제를 확인해주세요.')
  }
  if (!body.result || typeof body.result !== 'object' || Array.isArray(body.result)) fail('생성 결과가 없습니다.')
  if (body.kind === 'caption' && typeof body.result.caption !== 'string') fail('캡션 결과가 없습니다.')
  if (body.kind === 'thumbnail' && (
    !Array.isArray(body.result.recommendations) || !body.result.recommendations.length ||
    body.result.recommendations.some(item => !item || typeof item.title !== 'string')
  )) fail('제목 결과가 없습니다.')
  if (body.input.imagePreview != null && (
    typeof body.input.imagePreview !== 'string' || !/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(body.input.imagePreview)
  )) fail('이미지 미리보기를 확인해주세요.')
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 700000) fail('저장할 내용이 너무 큽니다.')
  if (body.projectId != null && !isUuid(body.projectId)) fail('프로젝트를 확인해주세요.')
  return {
    id: body.id, kind: body.kind, title: Array.from(body.input.topic.trim()).slice(0, 120).join(''),
    input: body.input, result: body.result, project_id: body.projectId || null,
    edited_caption: body.kind === 'caption' ? body.result.caption : null,
  }
}

async function queryResult(query) {
  const { data, error } = await query
  if (error) fail('내역을 저장하거나 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', 'TOOL_HISTORY_UNAVAILABLE', 503)
  return data
}

function assertSameSnapshot(existing, row) {
  // JSONB changes property ordering; equality must not rely on JSON serialization order.
  if (!existing || existing.kind !== row.kind || existing.project_id !== row.project_id ||
      !isDeepStrictEqual(existing.input, row.input) || !isDeepStrictEqual(existing.result, row.result)) {
    fail('같은 저장 요청의 내용이 달라졌습니다.', 'TOOL_HISTORY_CONFLICT', 409)
  }
}

export function createToolHistoryRouter({
  getDb = getSupabaseAdmin,
  resolveAccount = resolveRequestAccount,
  assertAccess = assertEntitlementAccess,
} = {}) {
  const router = Router()
  router.use('/tool-history', asyncHandler(async (req, res, next) => {
    await assertAccess({ userId: req.auth?.userId })
    req.toolAccount = await resolveAccount(req, { body: false, query: true })
    next()
  }))
  const scoped = req => getDb().from('tool_history').select(COLUMNS)
    .eq('user_id', req.auth.userId).eq('account_id', req.toolAccount.id)

  router.get('/tool-history', asyncHandler(async (req, res) => {
    res.json({ items: await queryResult(scoped(req).order('updated_at', { ascending: false }).limit(100)) })
  }))

  router.post('/tool-history', asyncHandler(async (req, res) => {
    const row = validateToolHistory(req.body)
    if (row.project_id) {
      const project = await queryResult(getDb().from('projects').select('id')
        .eq('id', row.project_id).eq('account_id', req.toolAccount.id).maybeSingle())
      if (!project) fail('프로젝트를 찾을 수 없습니다.', 'PROJECT_NOT_FOUND', 404)
    }
    const existing = await queryResult(scoped(req).eq('id', row.id).maybeSingle())
    if (existing) {
      assertSameSnapshot(existing, row)
      return res.json({ item: existing })
    }
    // Same-request replay may race with insert or a manual edit. Never overwrite either.
    await queryResult(getDb().from('tool_history').upsert({
      ...row, user_id: req.auth.userId, account_id: req.toolAccount.id,
    }, { onConflict: 'id', ignoreDuplicates: true }))
    const item = await queryResult(scoped(req).eq('id', row.id).maybeSingle())
    assertSameSnapshot(item, row)
    res.status(201).json({ item })
  }))

  router.patch('/tool-history/:id', asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id) || !Number.isSafeInteger(req.body?.version) || req.body.version < 1) {
      fail('수정할 내역을 확인해주세요.')
    }
    const patch = { version: req.body.version + 1, updated_at: new Date().toISOString() }
    if (req.body.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim() || Array.from(req.body.title).length > 120) fail('제목을 확인해주세요.')
      patch.title = req.body.title.trim()
    }
    if (req.body.editedCaption !== undefined) {
      if (typeof req.body.editedCaption !== 'string' || req.body.editedCaption.length > 30000) fail('캡션 내용을 확인해주세요.')
      patch.edited_caption = req.body.editedCaption
    }
    let query = getDb().from('tool_history').update(patch)
      .eq('id', req.params.id).eq('user_id', req.auth.userId).eq('account_id', req.toolAccount.id).eq('version', req.body.version)
    if (patch.edited_caption !== undefined) query = query.eq('kind', 'caption')
    const item = await queryResult(query.select(COLUMNS).maybeSingle())
    if (!item) fail('내역이 변경되었거나 삭제되었습니다. 다시 열어 확인해주세요.', 'TOOL_HISTORY_CONFLICT', 409)
    res.json({ item })
  }))

  router.delete('/tool-history/:id', asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) fail('내역을 확인해주세요.')
    await queryResult(getDb().from('tool_history').delete()
      .eq('id', req.params.id).eq('user_id', req.auth.userId).eq('account_id', req.toolAccount.id))
    res.json({ deleted: true })
  }))
  return router
}
