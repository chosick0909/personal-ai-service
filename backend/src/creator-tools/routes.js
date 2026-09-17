import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { asyncHandler } from '../lib/errors.js'
import { assertEntitlementAccess, assertUsageAllowed } from '../lib/entitlements.js'
import { KINDS, MAX_BYTES, featureEnabled, fail, normalizeBrief, normalizeInstagramUrl, stableHash, textInput, username, uuid, validateManifest, mediaUploadDisposition } from './domain.js'
import { database, query, ownedJob, ownedMedia, createJob, publicJob, BUCKET, OUTPUT_BUCKET, signedDownload } from './store.js'
import { enqueue } from './queue.js'
import { CREATOR_CATEGORIES, REFERENCE_CATEGORIES } from './categories.js'

export function createCreatorRouter() {
  const router = Router()
  const localPreview = () => process.env.CREATOR_LOCAL_PREVIEW_BYPASS_ENTITLEMENT === 'true'
    && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.CLIENT_ORIGIN || '')
  const assertCreatorAccess = (req) => localPreview() ? Promise.resolve() : assertEntitlementAccess({ userId: req.auth.userId })
  const referenceUsage = (req) => localPreview() ? Promise.resolve(null)
    : assertUsageAllowed({ userId: req.auth.userId, eventType: 'reference_analysis' })
  const enabled = (req, kind) => {
    if (!featureEnabled(kind, req.auth.userId)) fail('FEATURE_DISABLED', '아직 공개되지 않은 기능입니다.', 404)
  }
  const accountId = async (req, db) => {
    // The selected account in the request body is the freshest UI state. A
    // legacy/stale local-storage header must not override an explicit account.
    const id = uuid(req.body?.accountId || req.headers['x-account-id'])
    const row = await query(db.from('accounts').select('id').eq('id', id).eq('owner_user_id', req.auth.userId).maybeSingle())
    if (!row) fail('ACCOUNT_NOT_FOUND', '선택한 계정을 확인해주세요.', 404)
    return id
  }
  async function accept(row, res) {
    // The durable DB row is the outbox; worker reconciliation recovers Redis outages.
    try { await enqueue(row) } catch (e) { console.error('[creator-enqueue]', e.code || 'QUEUE_UNAVAILABLE') }
    res.status(row.status === 'completed' ? 200 : 202).json(publicJob(row))
  }
  router.get('/creator-tools/capabilities', asyncHandler(async (req, res) => {
    const features = Object.fromEntries(KINDS.map((kind) => [kind, featureEnabled(kind, req.auth.userId)]))
    res.json({ features, categories: CREATOR_CATEGORIES, referenceCategories: REFERENCE_CATEGORIES, trendCategories: REFERENCE_CATEGORIES, limits: { maxVideoBytes: MAX_BYTES, maxVideoSeconds: 300 },
      readiness: {
        'reference-accounts': { ready: Boolean(process.env.BRIGHT_DATA_API_KEY && process.env.BRIGHT_DATA_SERP_ZONE && process.env.OPENAI_API_KEY && process.env.CREATOR_REDIS_URL), message: '공개 계정 검색·프로필 조회 서비스 미연결입니다. 공급자 연결 후 사용할 수 있습니다.' },
        'trend-keywords': { ready: Boolean(process.env.OPENAI_API_KEY), message: 'AI 키워드 서비스를 연결해주세요.' },
        'media-analyze': { ready: Boolean(process.env.OPENAI_API_KEY && process.env.CREATOR_REDIS_URL), message: '음성 분석 서비스와 작업 서버 연결이 필요합니다.' },
        'import-link': { ready: Boolean(process.env.BRIGHT_DATA_API_KEY && process.env.OPENAI_API_KEY), message: '인스타그램 링크 수집 서비스 연결이 필요합니다.' },
      },
      sources: { googleTrends: 'alpha_not_connected' } })
  }))
  router.get('/creator-tools/jobs', asyncHandler(async (req, res) => {
    const kinds = KINDS.filter((kind) => featureEnabled(kind, req.auth.userId))
    if (!kinds.length) return res.json({ jobs: [] })
    const rows = await query(database().from('creator_jobs').select('*').eq('user_id', req.auth.userId).in('kind', kinds).order('created_at', { ascending: false }).limit(30))
    res.json({ jobs: rows.map(publicJob) })
  }))
  router.get('/creator-tools/jobs/:id', asyncHandler(async (req, res) => {
    const row = await ownedJob(database(), uuid(req.params.id), req.auth.userId)
    enabled(req, row.kind)
    res.json(publicJob(row))
  }))
  router.post('/creator-tools/jobs/:id/retry', asyncHandler(async (req, res) => {
    const db = database(), previous = await ownedJob(db, uuid(req.params.id), req.auth.userId)
    enabled(req, previous.kind)
    if (previous.status !== 'failed') fail('RETRY_NOT_FAILED', '실패한 작업만 다시 요청할 수 있습니다.', 409)
    await assertCreatorAccess(req)
    const input = { ...previous.input }
    if (['import-link', 'media-analyze'].includes(previous.kind)) {
      if (req.body.rightsConfirmed !== true) fail('RIGHTS_REQUIRED', '이번 자료의 분석 권한을 다시 확인해주세요.')
      input.rightsConfirmedAt = new Date().toISOString()
    }
    if (previous.kind === 'import-link') {
      const status = await referenceUsage(req)
      if (status) {
        input.entitlementId = status.entitlement.id
        input.monthlyReferenceLimit = status.entitlement.limits.monthlyReferenceLimit
      } else {
        delete input.entitlementId
        delete input.monthlyReferenceLimit
      }
      // Reject deleted/reassigned accounts before queueing.
      const owner = await query(db.from('accounts').select('id').eq('id', previous.account_id).eq('owner_user_id', req.auth.userId).maybeSingle())
      if (!owner) fail('ACCOUNT_NOT_FOUND', '작업 계정을 찾을 수 없습니다.', 404)
    }
    if (previous.kind.startsWith('media-')) {
      const media = await ownedMedia(db, input.projectId, req.auth.userId)
      if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다. 새 파일을 올려주세요.', 410)
      if (previous.kind === 'media-render' && (req.body.confirmed !== true || media.revision !== input.revision)) fail('EDIT_CONFLICT', '최신 편집 내용을 확인한 뒤 내보내주세요.', 409)
    }
    // One retry per failed parent, even from two tabs with different request IDs.
    const key = `retry:${previous.id}`
    const row = await createJob(db, { userId: req.auth.userId, accountId: previous.account_id, kind: previous.kind, key,
      input, hashInput: { previousJobId: previous.id } })
    if (input.projectId && previous.kind.startsWith('media-')) await query(db.from('creator_media_projects').update({job_id:row.id}).eq('id',input.projectId).eq('user_id',req.auth.userId))
    await accept(row,res)
  }))
  for (const kind of ['reference-accounts', 'trend-keywords']) {
    router.post(`/discovery/${kind}`, asyncHandler(async (req, res) => {
      enabled(req, kind)
      await assertCreatorAccess(req)
      const input = normalizeBrief(req.body || {}, kind)
      if (kind === 'reference-accounts') {
        if (!process.env.BRIGHT_DATA_API_KEY || !process.env.BRIGHT_DATA_SERP_ZONE) fail('ACCOUNT_PROVIDER_NOT_CONFIGURED', '공개 계정 검색 서비스 연결이 필요합니다.', 503)
        if (req.body.excludeAccounts != null && (!Array.isArray(req.body.excludeAccounts) || req.body.excludeAccounts.length > 100)) fail('INVALID_INPUT', '제외 계정 목록을 확인해주세요.')
        input.excludeAccounts = [...new Set((req.body.excludeAccounts || []).map(username))].sort()
      }
      const key = textInput(req.body.clientRequestId, '요청 ID', 8, 100)
      const db = database()
      const row = await createJob(db, { userId: req.auth.userId, kind, key, input })
      await accept(row, res)
    }))
    router.get(`/discovery/${kind}/:id`, asyncHandler(async (req, res) => {
      enabled(req, kind)
      res.json(publicJob(await ownedJob(database(), uuid(req.params.id), req.auth.userId, kind)))
    }))
  }
  router.get('/discovery/account-preferences', asyncHandler(async (req, res) => {
    enabled(req, 'reference-accounts')
    res.json({ preferences: await query(database().from('creator_account_preferences').select('username,preference').eq('user_id', req.auth.userId)) })
  }))
  router.put('/discovery/account-preferences/:username', asyncHandler(async (req, res) => {
    enabled(req, 'reference-accounts')
    const name = username(req.params.username)
    const preference = req.body.preference
    if (!['saved','excluded',null].includes(preference)) fail('INVALID_PREFERENCE', '저장 또는 제외를 선택해주세요.')
    const db = database()
    if (preference === null) await query(db.from('creator_account_preferences').delete().eq('user_id', req.auth.userId).eq('username', name))
    else await query(db.from('creator_account_preferences').upsert({ user_id: req.auth.userId, username: name, preference }))
    res.json({ username: name, preference })
  }))
  router.post('/reference-videos/import-link', asyncHandler(async (req, res) => {
    enabled(req, 'import-link')
    if (req.body.rightsConfirmed !== true) fail('RIGHTS_REQUIRED', '분석 권한이 있는 영상인지 확인해주세요.')
    const input = { url: normalizeInstagramUrl(req.body.url) }
    const db = database(), ownerAccount = await accountId(req, db)
    const key = textInput(req.body.clientImportId, '요청 ID', 8, 100)
    const alias = await query(db.from('creator_request_aliases').select('job_id').eq('user_id', req.auth.userId).eq('kind', 'import-link').eq('request_key', key).maybeSingle())
    const existing = alias ? await ownedJob(db, alias.job_id, req.auth.userId, 'import-link') : null
    const hashInput = { ...input, accountId: ownerAccount }
    if (existing) {
      if (existing.input_hash !== stableHash(hashInput)) fail('IDEMPOTENCY_CONFLICT', '같은 요청 ID의 내용이 달라졌습니다.', 409)
      return accept(existing, res)
    }
    if (!process.env.BRIGHT_DATA_API_KEY) fail('LINK_PROVIDER_NOT_CONFIGURED', '링크 분석 연결이 준비되지 않았습니다.', 503)
    const status = await referenceUsage(req)
    const row = await createJob(db, { userId: req.auth.userId, accountId: ownerAccount, kind: 'import-link', key, hashInput,
      input: { ...input, ...(status ? { entitlementId: status.entitlement.id, monthlyReferenceLimit: status.entitlement.limits.monthlyReferenceLimit } : {}),
        rightsConfirmedAt: new Date().toISOString() } })
    await accept(row, res)
  }))
  router.post('/media-projects', asyncHandler(async (req, res) => {
    enabled(req, 'media-analyze')
    await assertCreatorAccess(req)
    const body = req.body || {}
    if (body.rightsConfirmed !== true) fail('RIGHTS_REQUIRED', '직접 제작했거나 분석·편집 권한이 있는 영상인지 확인해주세요.')
    const name = textInput(body.filename, '파일명', 1, 255)
    const clientId = textInput(body.clientUploadId, '업로드 ID', 8, 100)
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(body.mimeType) || !Number.isInteger(body.size) || body.size <= 0 || body.size > MAX_BYTES) fail('INVALID_VIDEO', '300MB 이하 MP4·MOV·WebM 영상을 올려주세요.')
    const db = database()
    let row = await query(db.from('creator_media_projects').select('*').eq('user_id', req.auth.userId).eq('client_id', clientId).maybeSingle())
    if (!row) {
      const id = randomUUID()
      row = await query(db.rpc('creator_create_media', { p_id: id, p_user: req.auth.userId, p_client: clientId,
        p_name: name, p_mime: body.mimeType, p_size: body.size, p_path: `${req.auth.userId}/${id}/original` }))
    }
    if (mediaUploadDisposition(row, { ...body, filename: name }) === 'resume') {
      const previous = await ownedJob(db, row.job_id, req.auth.userId)
      enabled(req, previous.kind)
      return res.status(200).json({ id: row.id, job: publicJob(previous) })
    }
    const upload = await query(db.storage.from(BUCKET).createSignedUploadUrl(row.original_path))
    res.status(201).json({ id: row.id, upload: { token: upload.token, path: row.original_path, bucket: BUCKET,
      endpoint: `${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/upload/resumable/sign` }, expiresAt: row.original_expires_at })
  }))
  router.post('/media-projects/:id/analyze', asyncHandler(async (req, res) => {
    enabled(req, 'media-analyze')
    await assertCreatorAccess(req)
    const db = database(), media = await ownedMedia(db, uuid(req.params.id), req.auth.userId)
    if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다.', 410)
    if (req.body.rightsConfirmed !== true) fail('RIGHTS_REQUIRED', '이번 영상의 분석·편집 권한을 확인해주세요.')
    const caption = req.body.feedbackCaption === undefined ? null : textInput(req.body.feedbackCaption, '캡션', 1, 5000)
    const input = { projectId: media.id, ...(caption !== null ? { feedbackCaption: caption } : {}) }
    const key = caption !== null ? `${media.id}:feedback:${stableHash(caption)}` : media.id
    const row = await createJob(db, { userId: req.auth.userId, kind: 'media-analyze', key, hashInput: input,
      input: { ...input, rightsConfirmedAt: new Date().toISOString() } })
    await query(db.from('creator_media_projects').update({ job_id: row.id }).eq('id', media.id))
    await accept(row, res)
  }))
  router.get('/media-projects/:id', asyncHandler(async (req, res) => {
    enabled(req, 'media-analyze')
    const db = database(), media = await ownedMedia(db, uuid(req.params.id), req.auth.userId)
    const job = media.job_id ? await ownedJob(db, media.job_id, req.auth.userId) : null
    res.json({ id: media.id, originalName: media.original_name, status: media.status, durationSeconds: media.duration_seconds,
      revision: media.revision, manifest: { cuts: media.manifest.cuts, subtitles: media.manifest.subtitles, ...(media.manifest.clips ? { clips: media.manifest.clips } : {}) },
      previewUrl: Date.parse(media.original_expires_at) > Date.now() ? await signedDownload(db, media.preview_path) : null,
      downloadUrl: Date.parse(media.output_expires_at) > Date.now() && !media.output_deleted_at && media.output_path?.endsWith(`output-${media.revision}.zip`) ? await signedDownload(db, media.output_path, OUTPUT_BUCKET) : null,
      originalExpiresAt: media.original_expires_at, outputExpiresAt: media.output_expires_at, job: job ? publicJob(job) : null })
  }))
  router.patch('/media-projects/:id/edit-manifest', asyncHandler(async (req, res) => {
    enabled(req, 'media-analyze')
    const db = database(), media = await ownedMedia(db, uuid(req.params.id), req.auth.userId)
    if (!['ready','completed'].includes(media.status)) fail('MEDIA_NOT_READY', '영상 분석 완료 후 수정할 수 있습니다.', 409)
    if (req.body.revision !== media.revision) fail('EDIT_CONFLICT', '다른 화면에서 편집한 내용이 있습니다. 다시 불러와주세요.', 409)
    if (Date.parse(media.original_expires_at) <= Date.now()) fail('MEDIA_EXPIRED', '원본 보관 기간이 지났습니다. 자막을 다운로드한 후 새 영상을 올려주세요.', 410)
    const manifest = validateManifest(req.body.manifest, media.manifest, Number(media.duration_seconds))
    const row = await query(db.from('creator_media_projects').update({ manifest, revision: media.revision + 1 })
      .eq('id', media.id).eq('revision', media.revision).select('revision').maybeSingle())
    if (!row) fail('EDIT_CONFLICT', '편집 내용이 변경되었습니다. 다시 불러와주세요.', 409)
    res.json({ revision: row.revision, manifest: { cuts: manifest.cuts, subtitles: manifest.subtitles, ...(manifest.clips ? { clips: manifest.clips } : {}) } })
  }))
  router.post('/media-projects/:id/render', asyncHandler(async (req, res) => {
    enabled(req, 'media-render')
    await assertCreatorAccess(req)
    const db = database(), media = await ownedMedia(db, uuid(req.params.id), req.auth.userId)
    if (req.body.confirmed !== true || req.body.revision !== media.revision || !['ready','completed'].includes(media.status)) fail('RENDER_CONFIRMATION_REQUIRED', '최신 편집 내용을 확인한 뒤 내보내주세요.', 409)
    const row = await createJob(db, { userId: req.auth.userId, kind: 'media-render', key: `${media.id}:${media.revision}`,
      input: { projectId: media.id, revision: media.revision, manifest: media.manifest } })
    await query(db.from('creator_media_projects').update({ job_id: row.id }).eq('id', media.id))
    await accept(row, res)
  }))
  return router
}
