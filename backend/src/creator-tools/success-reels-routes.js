import { Router } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import Redis from 'ioredis'
import { asyncHandler } from '../lib/errors.js'
import { fail, uuid } from './domain.js'
import { database, query } from './store.js'
import { redisConnection } from './queue.js'
import { createProviders } from './providers.js'
import { readPublicImage } from './network.js'
import { ingestAccount, listSuccessReels } from './success-reels.js'
import { requestReelAnalysis, requestReelPlan, reelDetail, reelVideoUrl, reelActivity } from './success-reel-analysis.js'
import { keywordsForDay } from './success-reels-keywords.js'

export function successReelsEnabled(userId, env = process.env) {
  if (env.CREATOR_SUCCESS_REELS_ENABLED === 'true') return true
  return String(env.CREATOR_SUCCESS_REELS_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean).includes(userId)
}

// The Mac mini collector holds one random token; the server keeps only its SHA-256.
export function ingestTokenValid(header, env = process.env) {
  const expected = String(env.CREATOR_REELS_INGEST_TOKEN_SHA256 || '').trim().toLowerCase()
  const token = /^Bearer (\S{32,200})$/.exec(header || '')?.[1]
  if (!/^[0-9a-f]{64}$/.test(expected) || !token) return false
  const actual = createHash('sha256').update(token).digest()
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
}

let redis
const sharedRedis = () => {
  if (!redis) { redis = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1 }); redis.on('error', () => {}) }
  return redis
}

// Mounted before user authentication: the collector authenticates with its own token.
export function createReelIngestRouter() {
  const router = Router()
  router.use(asyncHandler(async (req, _res, next) => {
    if (!ingestTokenValid(req.headers.authorization)) fail('UNAUTHORIZED', '수집기 인증에 실패했습니다.', 401)
    next()
  }))
  router.get('/success-reels/plan', asyncHandler(async (_req, res) => {
    // Days roll over at midnight KST so the 03:30 run always starts a new rotation.
    const day = Math.floor((Date.now() + 9 * 3600000) / 86400000)
    const maxAccounts = Math.min(150, Math.max(1, Number(process.env.CREATOR_REELS_ACCOUNTS_PER_DAY) || 80))
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const db = database()
    const recent = await query(db.from('creator_reel_accounts').select('username').gt('last_seen_at', weekAgo).limit(5000))
    // Approved accounts tend to go viral again, so they are revisited weekly first.
    const recheck = await query(db.from('creator_reel_accounts').select('username').eq('eligible', true)
      .lte('last_seen_at', weekAgo).order('last_seen_at', { ascending: true }).limit(Math.ceil(maxAccounts / 2)))
    res.json({ day, keywords: keywordsForDay(day), maxAccounts, skipAccounts: recent.map(row => row.username),
      recheckAccounts: recheck.map(row => row.username) })
  }))
  router.post('/success-reels/runs', asyncHandler(async (_req, res) => {
    const row = await query(database().from('creator_reel_ingest_runs').insert({}).select('id').single())
    res.status(201).json({ id: row.id })
  }))
  router.patch('/success-reels/runs/:id', asyncHandler(async (req, res) => {
    const stats = req.body?.stats && typeof req.body.stats === 'object' ? req.body.stats : {}
    const error = typeof req.body?.error === 'string' ? req.body.error.slice(0, 1000) : null
    await query(database().from('creator_reel_ingest_runs').update({ finished_at: new Date().toISOString(), stats, error }).eq('id', uuid(req.params.id)))
    res.json({ ok: true })
  }))
  router.post('/success-reels/accounts', asyncHandler(async (req, res) => {
    const controller = new AbortController()
    // req emits 'close' as soon as the body is read; only a dropped response means the collector left.
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    const db = database()
    const providers = createProviders({ db, redis: sharedRedis(), job: { id: null, user_id: null }, signal: controller.signal })
    const result = await ingestAccount({ db, providers, readImage: url => readPublicImage(url, controller.signal) }, req.body)
    res.json(result)
  }))
  return router
}

// User-facing routes live under /creator-tools so the coupon access gate applies.
export function registerSuccessReelRoutes(router) {
  const enabled = req => { if (!successReelsEnabled(req.auth.userId)) fail('FEATURE_DISABLED', '아직 공개되지 않은 기능입니다.', 404) }
  router.get('/creator-tools/success-reels', asyncHandler(async (req, res) => {
    enabled(req)
    res.set('Cache-Control', 'private, no-store').json(await listSuccessReels(database(), req.query, req.auth.userId))
  }))
  const code = value => /^[A-Za-z0-9_-]{5,40}$/.test(value) ? value : fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
  const deps = () => ({ db: database(), redis: sharedRedis(), makeProviders: signal => createProviders({ db: database(), redis: sharedRedis(), job: { id: null, user_id: null }, signal }) })
  router.get('/creator-tools/success-reel-activity', asyncHandler(async (req, res) => {
    enabled(req)
    res.set('Cache-Control', 'private, no-store').json({ items: await reelActivity(database(), req.auth.userId) })
  }))
  router.get('/creator-tools/success-reels/:shortcode', asyncHandler(async (req, res) => {
    enabled(req)
    res.set('Cache-Control', 'private, no-store').json(await reelDetail(database(), req.auth.userId, code(req.params.shortcode)))
  }))
  router.post('/creator-tools/success-reels/:shortcode/analysis', asyncHandler(async (req, res) => {
    enabled(req)
    res.status(202).json(await requestReelAnalysis(deps(), code(req.params.shortcode), Date.now(), req.auth.userId))
  }))
  router.put('/creator-tools/success-reels/:shortcode/save', asyncHandler(async (req, res) => {
    enabled(req)
    const shortcode = code(req.params.shortcode), db = database()
    const reel = await query(db.from('creator_success_reels').select('shortcode').eq('shortcode', shortcode).eq('visible', true).maybeSingle())
    if (!reel) fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
    if (req.body?.saved === true) await query(db.from('creator_reel_saves').upsert({ user_id: req.auth.userId, shortcode }))
    else await query(db.from('creator_reel_saves').delete().eq('user_id', req.auth.userId).eq('shortcode', shortcode))
    res.json({ shortcode, saved: req.body?.saved === true })
  }))
  router.post('/creator-tools/success-reels/:shortcode/plans', asyncHandler(async (req, res) => {
    enabled(req)
    res.status(202).json(await requestReelPlan(deps(), req.auth.userId, code(req.params.shortcode), req.body?.brief))
  }))
  router.get('/creator-tools/success-reel-plans/:id', asyncHandler(async (req, res) => {
    enabled(req)
    const row = await query(database().from('creator_reel_plans').select('id,shortcode,brief,status,plan,error,created_at').eq('id', uuid(req.params.id)).eq('user_id', req.auth.userId).maybeSingle())
    if (!row) fail('PLAN_NOT_FOUND', '기획안을 찾을 수 없습니다.', 404)
    res.set('Cache-Control', 'private, no-store').json({ id: row.id, shortcode: row.shortcode, brief: row.brief, status: row.status, plan: row.plan, error: row.error, createdAt: row.created_at })
  }))
  router.post('/creator-tools/success-reels/:shortcode/playback', asyncHandler(async (req, res) => {
    enabled(req)
    const shortcode = /^[A-Za-z0-9_-]{5,40}$/.test(req.params.shortcode) ? req.params.shortcode : null
    const row = shortcode && await query(database().from('creator_success_reels').select('shortcode').eq('shortcode', shortcode).eq('visible', true).maybeSingle())
    if (!row) fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    const providers = createProviders({ db: database(), redis: sharedRedis(), job: { id: null, user_id: null }, signal: controller.signal })
    const url = await reelVideoUrl({ providers, redis: sharedRedis() }, shortcode).catch(() => null)
    res.set('Cache-Control', 'private, no-store').json({ media: url ? { url } : null })
  }))
}
