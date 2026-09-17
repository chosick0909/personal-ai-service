import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import Redis from 'ioredis'
import { database, query, updateJob } from './store.js'
import { redisConnection } from './queue.js'
import { createProviders } from './providers.js'
import { discoverAccounts, discoverKeywords } from './discovery.js'
import { analyzeMedia, renderMedia } from './media.js'
import { importLink } from './link-import.js'
import { featureEnabled, fail } from './domain.js'

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
const handlers = { 'reference-accounts': discoverAccounts, 'trend-keywords': discoverKeywords,
  'media-analyze': analyzeMedia, 'media-render': renderMedia, 'import-link': importLink }

process.once('message', async ({ id }) => {
  const redis = new Redis({ ...redisConnection(), maxRetriesPerRequest: 1 })
  redis.on('error', () => {})
  const db = database()
  const controller = new AbortController()
  process.once('SIGTERM', () => controller.abort())
  let heartbeat
  try {
    const job = await query(db.from('creator_jobs').select('*').eq('id', id).single())
    if (['completed','failed','cancelled'].includes(job.status)) { process.send({ ok: true }); return }
    if (!featureEnabled(job.kind, job.user_id)) fail('FEATURE_DISABLED', '현재 새 도구 이용이 중지되었습니다.', 503)
    await updateJob(db, id, { status: 'running', attempts: job.attempts + 1 })
    heartbeat = setInterval(() => { void updateJob(db, id, {}).catch(() => {}) }, 30000)
    const ctx = { db, redis, job, signal: controller.signal }
    ctx.providers = createProviders(ctx)
    ctx.stage = async (name) => {
      const row = await updateJob(db, id, { stage: name })
      if (!row) fail('JOB_STOPPED', '작업이 중단되었습니다.', 409)
    }
    ctx.checkpoint = async (name, fn) => {
      if (Object.hasOwn(job.checkpoint, name)) return job.checkpoint[name]
      const value = await fn()
      job.checkpoint[name] = value
      await updateJob(db, id, { checkpoint: job.checkpoint })
      return value
    }
    const result = await handlers[job.kind](ctx)
    await query(db.rpc('creator_complete_job', { p_id: id, p_result: result }))
    process.send({ ok: true })
  } catch (error) {
    const status = Number(error.statusCode || error.status)
    process.send({ ok: false, code: error.code || 'JOB_FAILED',
      message: error.exposeMessage ? error.message : '작업을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.',
      retryable: !status || status >= 500 || status === 429 })
  } finally {
    clearInterval(heartbeat)
    await redis.quit().catch(() => {})
    process.disconnect()
  }
})
