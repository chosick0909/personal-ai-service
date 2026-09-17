import { Queue } from 'bullmq'
import { fail } from './domain.js'

export function redisConnection(env = process.env) {
  if (!env.CREATOR_REDIS_URL) fail('QUEUE_NOT_CONFIGURED', '새 도구의 작업 서버가 준비되지 않았습니다.', 503)
  const url = new URL(env.CREATOR_REDIS_URL)
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid CREATOR_REDIS_URL')
  return { host: url.hostname, port: Number(url.port || 6379), username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined, db: Number(url.pathname.slice(1) || 0),
    tls: url.protocol === 'rediss:' ? {} : undefined, connectTimeout: 3000 }
}
export function queueName(kind) { return kind.startsWith('media-') ? 'creator-media' : 'creator-discovery' }
export function workerConcurrency(env = process.env) {
  const value = Number(env.CREATOR_WORKER_CONCURRENCY || 1)
  if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('CREATOR_WORKER_CONCURRENCY must be an integer from 1 to 8')
  return value
}
const queues = new Map()
export function getQueue(kind) {
  const name = queueName(kind)
  if (!queues.has(name)) {
    const q = new Queue(name, { connection: { ...redisConnection(), maxRetriesPerRequest: 1, enableOfflineQueue: false } })
    q.on('error', (error) => console.error('[creator-queue]', error.code || 'QUEUE_ERROR'))
    queues.set(name, q)
  }
  return queues.get(name)
}
export async function enqueue(row) {
  if (!['queued', 'running'].includes(row.status)) return
  await getQueue(row.kind).add(row.kind, { id: row.id }, {
    jobId: row.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 }, removeOnFail: { age: 86400 },
  })
}
export async function closeQueues() { for (const q of queues.values()) await q.close(); queues.clear() }
