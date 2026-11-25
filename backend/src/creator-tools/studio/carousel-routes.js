import multer from 'multer'
import { asyncHandler } from '../../lib/errors.js'
import { fail, uuid } from '../domain.js'
import { database, query } from '../store.js'
import { schedule, isScheduled } from '../success-reel-analysis.js'
import { carouselMakerEnabled } from './access.js'
import { CAROUSEL_STAGES, CAROUSEL_OPENERS, companionPlan, nextCarouselStage, generateCarouselStage, applyCarouselPatch, applyCarouselProposal, carouselChat, publicCarousel, resolveCarouselSources, normalizeCarouselSources, normalizeDesign } from './carousel.js'
import { IMAGE_TIERS, IMAGE_SHAPES, writeImagePrompt, generateImage, storeImage, listImages, designImages, removeImage, signImages, allowanceUsed, monthlyAllowance, sweepUnkept, LIBRARY_LIMIT } from './carousel-images.js'

import { draftSheet, makeSheet, SHEET_LIMITS } from './carousel-sheet.js'
import { searchStock, fetchStockPhoto, stockReady, STOCK_SOURCE } from './carousel-stock.js'

const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : ''
const message = error => error?.exposeMessage ? error.message : '훅ai가 잠시 멈췄어요. 다시 시도해주세요.'
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 4, fieldSize: 1024 } })
const jobKey = (id, stage) => `carousel:${id}:${stage}`
// Stages 훅ai writes; the design is laid out in the browser and only saved here.
const WRITTEN = ['cover', 'body', 'slides', 'caption']

// One stage written in the background; the row carries the job state the screen polls. A job writes its outcome
// only while the plan still waits on it.
export function runCarouselJob(deps, id, stage, note = '') {
  return (deps.schedule || schedule)(jobKey(id, stage), async () => {
    const db = deps.db
    const waiting = request => request.eq('id', id).eq('job_status', 'running').eq('job_stage', stage)
    try {
      const row = await query(db.from('studio_carousels').select('*').eq('id', id).single())
      const { value, topic, title } = await generateCarouselStage(deps, row, stage, { note })
      await query(waiting(db.from('studio_carousels').update({ [stage]: value, ...(topic ? { topic } : {}), ...(title && !row.title ? { title } : {}), stage, job_status: 'idle', job_stage: null, job_error: null, updated_at: new Date().toISOString() })))
    } catch (error) {
      console.error('[carousel-stage]', stage, error?.code || 'FAILED')
      await query(waiting(db.from('studio_carousels').update({ job_status: 'failed', job_error: message(error), updated_at: new Date().toISOString() }))).catch(() => {})
    }
  }, Infinity, 'studio')
}
export async function startCarouselStage(deps, row, stage, { note = '' } = {}) {
  const patch = { job_status: 'running', job_stage: stage, job_error: null, job_started_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  await query(deps.db.from('studio_carousels').update(patch).eq('id', row.id))
  runCarouselJob(deps, row.id, stage, note)
  return { ...row, ...patch }
}

export function registerCarouselRoutes(router, deps) {
  const enabled = req => { if (!carouselMakerEnabled(req.auth.userId)) fail('FEATURE_DISABLED', '아직 공개되지 않은 기능입니다.', 404) }
  const owned = async req => {
    const row = await query(database().from('studio_carousels').select('*').eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).maybeSingle())
    if (!row) fail('CAROUSEL_NOT_FOUND', '캐러셀을 찾을 수 없어요.', 404)
    return row
  }
  const say = (row, role, stage, content, meta = {}) => query(database().from('studio_carousel_messages').insert({ carousel_id: row.id, user_id: row.user_id, role, stage, content, meta }).select('*').single())
  const publicMessage = m => ({ id: m.id, role: m.role, stage: m.stage, content: m.content, meta: m.meta || {}, createdAt: m.created_at })
  const history = id => query(database().from('studio_carousel_messages').select('*').eq('carousel_id', id).order('created_at', { ascending: true }).limit(200))
  const full = async (row, userId) => {
    const resolved = await resolveCarouselSources(database(), userId, row.sources).catch(() => ({}))
    return { carousel: publicCarousel(row), messages: (await history(row.id).catch(() => [])).map(publicMessage), images: await designImages(database(), userId, row.design).catch(() => ({})),
      sources: Object.fromEntries(Object.entries(resolved).map(([slot, s]) => [slot, { id: s.id, label: s.label, kind: s.kind, permalink: s.permalink }])),
      plan: await companionPlan(database(), row).then(p => p && { id: p.id, title: p.title }).catch(() => null) }
  }

  router.get('/creator-tools/studio/carousels', asyncHandler(async (req, res) => {
    enabled(req)
    const rows = await query(database().from('studio_carousels').select('id,stage,title,topic,job_status,slides,created_at,updated_at').eq('user_id', req.auth.userId).order('updated_at', { ascending: false }).limit(100))
    res.set('Cache-Control', 'private, no-store').json({ carousels: rows.map(r => ({ id: r.id, stage: r.stage, title: r.title || r.topic?.title || null, slideCount: r.slides?.items?.length || 0, jobStatus: r.job_status, createdAt: r.created_at, updatedAt: r.updated_at })) })
  }))
  router.post('/creator-tools/studio/carousels', asyncHandler(async (req, res) => {
    enabled(req)
    // 릴스·캐러셀 동시 제작: started from a reel plan, the carousel takes that plan's topic and research as they are
    // (nothing is researched again) and reads the plan itself on every stage.
    const plan = req.body?.fromPlan ? await query(database().from('studio_sessions').select('id,brief,topic').eq('id', uuid(req.body.fromPlan)).eq('user_id', req.auth.userId).maybeSingle()) : null
    if (req.body?.fromPlan && !plan) fail('PLAN_NOT_FOUND', '기획안을 찾을 수 없어요.', 404)
    const brief = text(req.body?.brief, 8000) || text(plan?.brief, 8000) || text(plan?.topic?.brief, 8000) || text(plan?.topic?.title, 8000)
    if (brief.length < 4) fail('BRIEF_REQUIRED', '어떤 캐러셀을 만들지 적어주세요.')
    const sources = normalizeCarouselSources({ ...(req.body?.sources || {}), ...(plan ? { plan: { id: plan.id } } : {}) })
    await resolveCarouselSources(database(), req.auth.userId, sources)
    const style = await query(database().from('studio_styles').select('card').eq('user_id', req.auth.userId).maybeSingle())
    const row = await query(database().from('studio_carousels').insert({ user_id: req.auth.userId, brief, sources, style_snapshot: style?.card || null, ...(plan?.topic ? { topic: plan.topic } : {}) }).select('*').single())
    await say(row, 'hookai', 'cover', CAROUSEL_OPENERS.cover).catch(() => {})
    res.status(201).json(await full(await startCarouselStage(deps(), row, 'cover'), req.auth.userId))
  }))
  router.get('/creator-tools/studio/carousels/:id', asyncHandler(async (req, res) => {
    enabled(req)
    let row = await owned(req)
    // Jobs run inside this server process: one cut off by a deploy is started again when the plan is next opened.
    if (row.job_status === 'running' && row.job_stage && !isScheduled(jobKey(row.id, row.job_stage))) row = await startCarouselStage(deps(), row, row.job_stage)
    res.set('Cache-Control', 'private, no-store').json(await full(row, req.auth.userId))
  }))
  router.delete('/creator-tools/studio/carousels/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    await query(database().from('studio_carousels').delete().eq('id', row.id))
    res.json({ ok: true })
  }))
  // The student's edits: chosen options, their own cover title, edited body, slides, design, caption.
  router.patch('/creator-tools/studio/carousels/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const patch = applyCarouselPatch(row, req.body || {})
    if (typeof req.body?.brief === 'string') patch.brief = text(req.body.brief, 8000)
    const updated = await query(database().from('studio_carousels').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single())
    res.json(await full(updated, req.auth.userId))
  }))
  // Move to a stage (훅ai writes it on the first visit) or write the current one again, with an optional request.
  router.post('/creator-tools/studio/carousels/:id/stage', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const stage = CAROUSEL_STAGES.includes(req.body?.stage) ? req.body.stage : nextCarouselStage(row.stage)
    const again = req.body?.regenerate === true
    if (row.job_status === 'running') fail('STAGE_BUSY', '훅ai가 아직 쓰는 중이에요. 잠시만 기다려주세요.', 409)
    // 훅ai greets a stage the first time it opens.
    if (stage !== row.stage && CAROUSEL_OPENERS[stage] && (stage === 'done' || !row[stage])) await say(row, 'hookai', stage, CAROUSEL_OPENERS[stage]).catch(() => {})
    if (WRITTEN.includes(stage) && (again || !row[stage])) return res.json(await full(await startCarouselStage(deps(), row, stage, { note: text(req.body?.note, 600) }), req.auth.userId))
    const patch = { stage, job_status: 'idle', job_stage: null, job_error: null, updated_at: new Date().toISOString() }
    if (stage === 'design') patch.design = (await generateCarouselStage(deps(), row, 'design')).value
    const updated = await query(database().from('studio_carousels').update(patch).eq('id', row.id).select('*').single())
    res.json(await full(updated, req.auth.userId))
  }))
  router.post('/creator-tools/studio/carousels/:id/cancel', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    if (row.job_status !== 'running') return res.json(await full(row, req.auth.userId))
    const updated = await query(database().from('studio_carousels').update({ job_status: 'idle', job_stage: null, job_error: null, updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single())
    res.json(await full(updated, req.auth.userId))
  }))

  // 훅ai answers in the background and the screen polls the plan, so a long revision never hits a request timeout.
  router.post('/creator-tools/studio/carousels/:id/chat', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const content = text(req.body?.text, 4000)
    if (!content) fail('MESSAGE_REQUIRED', '메시지를 적어주세요.')
    const before = await history(row.id)
    const mine = await say(row, 'user', row.stage, content)
    void (async () => {
      try {
        const reply = await carouselChat(deps(), row, before, content)
        await say(row, 'hookai', row.stage, reply.content, reply.meta)
      } catch (error) {
        console.error('[carousel-chat]', error?.code || 'FAILED')
        await say(row, 'hookai', row.stage, '앗, 이번 답은 만들지 못했어요. 같은 말을 한 번만 다시 보내주세요.', { failed: true }).catch(() => {})
      }
    })()
    res.status(202).json({ messages: [publicMessage(mine)], pending: true })
  }))
  // Apply a revision 훅ai offered in the conversation.
  router.post('/creator-tools/studio/carousels/:id/apply', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const message = await query(database().from('studio_carousel_messages').select('*').eq('id', uuid(req.body?.messageId)).eq('carousel_id', row.id).maybeSingle())
    const patch = applyCarouselProposal(row, message?.meta?.proposal)
    const updated = await query(database().from('studio_carousels').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single())
    res.json(await full(updated, req.auth.userId))
  }))

  // 총정리 한 장: 훅ai drafts the words from the finished slides, the student confirms them, then the sheet is drawn.
  router.post('/creator-tools/studio/carousels/:id/sheet/draft', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    res.json({ sheet: await draftSheet(deps().makeProviders(AbortSignal.timeout(120000)), row), limits: SHEET_LIMITS })
  }))
  router.post('/creator-tools/studio/carousels/:id/sheet', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const d = deps()
    const made = await makeSheet({ db: database(), redis: d.redis, providers: d.makeProviders(AbortSignal.timeout(420000)) }, req.auth.userId, req.body?.sheet, { colors: row.design?.colors || {} })
    res.status(201).json({ image: (await signImages(database(), [made.row]))[0], sheet: made.sheet, problems: made.problems, ai: made.ai })
  }))

  // 내 디자인: the look a student keeps (template, colours, fonts, account name), so every new carousel starts as theirs.
  router.put('/creator-tools/studio/carousel-design', asyncHandler(async (req, res) => {
    enabled(req)
    const { template, ratio, colors, fonts, handle } = normalizeDesign(req.body || {})
    const saved = { template, ratio, colors, fonts, handle }
    const row = await query(database().from('studio_styles').select('choices').eq('user_id', req.auth.userId).maybeSingle())
    if (row) await query(database().from('studio_styles').update({ choices: { ...(row.choices || {}), carouselDesign: saved } }).eq('user_id', req.auth.userId))
    else await query(database().from('studio_styles').insert({ user_id: req.auth.userId, choices: { carouselDesign: saved } }))
    res.json({ design: saved })
  }))

  // ----- 내 이미지 보관함 -----
  router.get('/creator-tools/studio/images', asyncHandler(async (req, res) => {
    enabled(req)
    const images = await listImages(database(), req.auth.userId)
    res.set('Cache-Control', 'private, no-store').json({ images, limit: LIBRARY_LIMIT, ai: { used: await allowanceUsed(deps().redis, req.auth.userId), allowance: monthlyAllowance(), ready: Boolean(String(process.env.FAL_KEY || '').trim()),
      tiers: Object.fromEntries(Object.entries(IMAGE_TIERS).map(([id, t]) => [id, { label: t.label, weight: t.weight }])) },
      stock: { ready: stockReady(), source: STOCK_SOURCE } })
  }))
  // The browser shrinks a photo before sending it (long side 2,160px) and sends a small preview with it.
  router.post('/creator-tools/studio/images', (req, res, next) => uploadImage.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }])(req, res, error => next(error ? fail('IMAGE_TOO_LARGE', '이미지는 8MB 이하로 올려주세요.') : undefined)), asyncHandler(async (req, res) => {
    enabled(req)
    const image = req.files?.image?.[0], thumb = req.files?.thumb?.[0]
    if (!image) fail('IMAGE_REQUIRED', '올릴 이미지를 골라주세요.')
    const size = n => { const v = Math.round(Number(n)); return v > 0 && v < 20000 ? v : null }
    const row = await storeImage(database(), req.auth.userId, { bytes: image.buffer, type: image.mimetype, thumb: thumb?.mimetype === 'image/jpeg' ? thumb.buffer : null, source: 'upload', width: size(req.body?.width), height: size(req.body?.height) })
    res.status(row.duplicate ? 200 : 201).json({ image: (await signImages(database(), [row]))[0], duplicate: Boolean(row.duplicate) })
  }))
  router.delete('/creator-tools/studio/images/:id', asyncHandler(async (req, res) => {
    enabled(req)
    await removeImage(database(), req.auth.userId, uuid(req.params.id))
    res.json({ ok: true })
  }))
  // 무료 사진 검색: results come from the stock site; a picked photo is copied into the student's library.
  router.get('/creator-tools/studio/images/stock', asyncHandler(async (req, res) => {
    enabled(req)
    res.set('Cache-Control', 'private, no-store').json({ ...(await searchStock({ redis: deps().redis }, { q: req.query.q, orientation: req.query.orientation, page: req.query.page })), source: STOCK_SOURCE })
  }))
  router.post('/creator-tools/studio/images/stock', asyncHandler(async (req, res) => {
    enabled(req)
    const photo = await fetchStockPhoto({}, req.body?.id)
    const row = await storeImage(database(), req.auth.userId, { ...photo, source: 'stock' })
    res.status(row.duplicate ? 200 : 201).json({ image: (await signImages(database(), [row]))[0], duplicate: Boolean(row.duplicate) })
  }))
  // An AI image for one slide: 훅ai writes the request from the slide and the mood the student picked.
  router.post('/creator-tools/studio/images/generate', asyncHandler(async (req, res) => {
    enabled(req)
    const tier = ['economy', 'standard'].includes(req.body?.tier) ? req.body.tier : 'economy'
    const shape = IMAGE_SHAPES[req.body?.shape] && req.body.shape !== 'sheet' ? req.body.shape : '4:5'
    const scene = text(req.body?.scene, 300), slide = text(req.body?.slide, 400)
    if (!scene && !slide) fail('IMAGE_SCENE_REQUIRED', '어떤 그림이 필요한지 한 줄로 적어주세요.')
    const d = deps(), providers = d.makeProviders(AbortSignal.timeout(300000))
    const written = await writeImagePrompt(providers, { scene, slide, topic: text(req.body?.topic, 200), style: req.body?.style, over: req.body?.over !== false })
    const made = await generateImage({ providers, redis: d.redis }, req.auth.userId, { tier, shape, prompt: written.prompt })
    // Kept only once the student places it in a design; images nobody chose are removed after a week.
    const row = await storeImage(database(), req.auth.userId, { bytes: made.bytes, type: made.type, source: 'ai', tier, prompt: written.prompt, width: made.width, height: made.height, kept: false })
    void sweepUnkept(database()).catch(() => {})
    res.status(201).json({ image: (await signImages(database(), [row]))[0], person: written.person, ai: { used: made.used, allowance: made.allowance } })
  }))
}
