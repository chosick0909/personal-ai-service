import multer from 'multer'
import { asyncHandler } from '../../lib/errors.js'
import { fail, uuid } from '../domain.js'
import { database, query } from '../store.js'
import { carouselMakerEnabled } from './access.js'
import { normalizeDesign } from './carousel.js'
import { IMAGE_TIERS, IMAGE_SHAPES, writeImagePrompt, generateImage, storeImage, listImages, removeImage, signImages, allowanceUsed, monthlyAllowance, sweepUnkept, LIBRARY_LIMIT } from './carousel-images.js'

import { draftSheet, makeSheet, SHEET_LIMITS } from './carousel-sheet.js'
import { searchStock, fetchStockPhoto, stockReady, STOCK_SOURCE } from './carousel-stock.js'

const text = (value, max) => typeof value === 'string' ? value.normalize('NFC').trim().slice(0, max) : ''
const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2, fields: 4, fieldSize: 1024 } })

// What stays the carousel's own: the 총정리 sheet, the look a student keeps, and the image library. The plan itself
// (topic, stages, the conversation with 훅ai) is a studio session whose format is 'carousel' — see routes.js.
export function registerCarouselRoutes(router, deps) {
  const enabled = req => { if (!carouselMakerEnabled(req.auth.userId)) fail('FEATURE_DISABLED', '아직 공개되지 않은 기능입니다.', 404) }
  const owned = async req => {
    const row = await query(database().from('studio_sessions').select('*').eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).eq('format', 'carousel').maybeSingle())
    if (!row) fail('CAROUSEL_NOT_FOUND', '캐러셀을 찾을 수 없어요.', 404)
    return row
  }

  // 총정리 한 장: 훅ai drafts the words from the finished slides, the student confirms them, then the sheet is drawn.
  router.post('/creator-tools/studio/sessions/:id/sheet/draft', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    res.json({ sheet: await draftSheet(deps().makeProviders(AbortSignal.timeout(120000)), row), limits: SHEET_LIMITS })
  }))
  router.post('/creator-tools/studio/sessions/:id/sheet', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await owned(req)
    const d = deps()
    const made = await makeSheet({ db: database(), redis: d.redis, providers: d.makeProviders(AbortSignal.timeout(420000)) }, req.auth.userId, req.body?.sheet, { colors: row.design?.colors || {} })
    res.status(201).json({ image: (await signImages(database(), [made.row]))[0], sheet: made.sheet, problems: made.problems, ai: made.ai })
  }))

  // 내 디자인: the look a student keeps (template, colours, fonts, account name), so every new carousel starts as theirs.
  router.put('/creator-tools/studio/carousel-design', asyncHandler(async (req, res) => {
    enabled(req)
    const { template, ratio, colors, fonts, handle, weightMix } = normalizeDesign(req.body || {})
    const saved = { template, ratio, colors, fonts, handle, ...(weightMix ? { weightMix } : {}) }
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
