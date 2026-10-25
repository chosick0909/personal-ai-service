import { Router } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import Redis from 'ioredis'
import { asyncHandler } from '../lib/errors.js'
import { fail, uuid } from './domain.js'
import { database, query } from './store.js'
import { redisConnection } from './queue.js'
import { createProviders } from './providers.js'
import { readPublicImage } from './network.js'
import { referencePlayback } from './reference-playback.js'
import { ingestAccount, listSuccessReels } from './success-reels.js'
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
    const day = Math.floor(Date.now() / 86400000)
    const perDay = Math.min(12, Math.max(1, Number(process.env.CREATOR_REELS_KEYWORDS_PER_DAY) || 6))
    const maxAccounts = Math.min(80, Math.max(1, Number(process.env.CREATOR_REELS_ACCOUNTS_PER_DAY) || 30))
    const recent = await query(database().from('creator_reel_accounts').select('username')
      .gt('last_seen_at', new Date(Date.now() - 7 * 86400000).toISOString()).limit(2000))
    res.json({ day, keywords: keywordsForDay(day, perDay), maxAccounts, skipAccounts: recent.map(row => row.username) })
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
    req.on('close', () => controller.abort())
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
    res.set('Cache-Control', 'private, no-store').json(await listSuccessReels(database(), req.query))
  }))
  router.post('/creator-tools/success-reels/:shortcode/playback', asyncHandler(async (req, res) => {
    enabled(req)
    const shortcode = /^[A-Za-z0-9_-]{5,40}$/.test(req.params.shortcode) ? req.params.shortcode : null
    const row = shortcode && await query(database().from('creator_success_reels').select('shortcode').eq('shortcode', shortcode).eq('visible', true).maybeSingle())
    if (!row) fail('REEL_NOT_FOUND', '확인할 수 없는 릴스입니다.', 404)
    const media = await referencePlayback.resolve(`https://www.instagram.com/reel/${shortcode}/`)
    res.set('Cache-Control', 'private, no-store').json({ media })
  }))
}
