import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { fork } from 'node:child_process'
import { readdir, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker, UnrecoverableError } from 'bullmq'
import { database, query, updateJob, BUCKET, OUTPUT_BUCKET } from './store.js'
import { redisConnection, enqueue, closeQueues, queueName, getQueue, workerConcurrency } from './queue.js'
import { KINDS } from './domain.js'

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true })
const db = database()
const group = process.env.CREATOR_WORKER_GROUP || 'discovery'
if (!['discovery', 'media'].includes(group)) throw new Error('Invalid CREATOR_WORKER_GROUP')
const name = `creator-${group}`
const concurrency = workerConcurrency()
const childPath = fileURLToPath(new URL('./job-process.js', import.meta.url))
const children = new Set()
const worker = new Worker(name, async (task) => {
  const row = await query(db.from('creator_jobs').select('*').eq('id', task.data.id).maybeSingle())
  if (!row || ['completed','cancelled','failed'].includes(row.status)) return
  const remaining = Math.min(15 * 60000, Date.parse(row.deadline_at) - Date.now())
  if (remaining <= 0) throw new UnrecoverableError('JOB_DEADLINE')
  const result = await new Promise((resolve, reject) => {
    const child = fork(childPath, [], { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: ['--max-old-space-size=768'] })
    children.add(child)
    let message
    const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ } }, remaining)
    child.on('message', (data) => { message = data })
    child.on('error', reject)
    child.on('exit', () => {
      clearTimeout(timer); children.delete(child)
      if (message) resolve(message)
      else reject(new Error('WORKER_INTERRUPTED'))
    })
    child.send({ id: row.id })
  })
  if (!result.ok) {
    await updateJob(db, row.id, { error_code: result.code, error_message: result.message, stage: result.retryable ? 'retrying' : 'failed' })
    if (!result.retryable) throw new UnrecoverableError(result.code)
    throw new Error(result.code)
  }
}, { connection: { ...redisConnection(), maxRetriesPerRequest: null }, concurrency,
  lockDuration: 60000, maxStalledCount: 2 })
worker.on('error', (e) => console.error('[creator-worker]', e.code || 'WORKER_ERROR'))
worker.on('failed', async (job, error) => {
  if (!job) return
  const terminal = error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts || 1)
  if (!terminal) return
  try {
    const prior = await query(db.from('creator_jobs').select('error_code,error_message').eq('id',job.data.id).maybeSingle())
    await updateJob(db, job.data.id, { status: 'failed', stage: 'failed', error_code: prior?.error_code || error.message,
      error_message: prior?.error_message || '작업을 완료하지 못했습니다. 파일 업로드·대본 붙여넣기 또는 새 작업으로 다시 시도해주세요.' })
  } catch (e) { console.error('[creator-worker-finalize]', e.code || 'DB_ERROR') }
})

let recovering = false
async function recover() {
  if (recovering) return
  recovering = true
  try {
    // Filter by this worker's queue before pagination; a discovery backlog must
    // not hide media outbox rows (or vice versa). Scan beyond the first 100 jobs.
    let offset = 0
    while (true) {
    const rows = await query(db.from('creator_jobs').select('id,kind,status,deadline_at,created_at').in('status', ['queued','running'])
      .in('kind', KINDS.filter(kind => queueName(kind) === name)).order('created_at').order('id').range(offset, offset + 99))
    for (const row of rows) {
      if (queueName(row.kind) !== name) continue
      if (Date.parse(row.deadline_at) <= Date.now()) {
        await updateJob(db, row.id, { status: 'failed', stage: 'failed', error_code: 'JOB_DEADLINE', error_message: '작업 제한 시간을 초과했습니다. 새 작업으로 다시 시도해주세요.' })
        continue
      }
      const stored = await getQueue(row.kind).getJob(row.id)
      const state = stored && await stored.getState()
      if (['failed', 'completed'].includes(state)) {
        // A queue terminal event can outlive a failed DB finalization write.
        await updateJob(db, row.id, { status: 'failed', stage: 'failed', error_code: 'WORKER_FINALIZATION_FAILED', error_message: '작업 완료 상태를 저장하지 못했습니다. 새 작업으로 다시 시도해주세요.' })
      } else await enqueue(row)
    }
    if (rows.length < 100) break
    offset += 100
    }
  } catch (e) { console.error('[creator-recovery]', e.code || 'RECOVERY_ERROR') }
  finally { recovering = false }
}

let cleaning = false
async function cleanup() {
  if (cleaning) return
  cleaning = true
  try {
    // Only directories allocated by workspace(), never other app/test files.
    for (const name of await readdir(tmpdir())) {
      if (!/^hookai-creator-media-[A-Za-z0-9]{6}$/.test(name)) continue
      const path = join(tmpdir(), name)
      const info = await stat(path).catch(() => null)
      if (info?.isDirectory() && Date.now() - info.mtimeMs > 3600000) await rm(path, { recursive: true, force: true })
    }
    if (group !== 'media') return
    for (const kind of ['original', 'output']) {
      const rows = await query(db.from('creator_media_projects').select('*').is(`${kind}_deleted_at`, null)
        .lt(`${kind}_expires_at`, new Date().toISOString()).limit(100))
      for (const row of rows) {
        const paths = kind === 'original' ? [row.original_path, row.preview_path] : [row.output_path]
        if (paths.some(Boolean)) await query(db.storage.from(kind === 'original' ? BUCKET : OUTPUT_BUCKET).remove(paths.filter(Boolean)))
        await query(db.from('creator_media_projects').update({ [`${kind}_deleted_at`]: new Date().toISOString() }).eq('id', row.id))
      }
    }
    const artifacts = await query(db.from('creator_media_artifacts').select('*').lt('expires_at', new Date().toISOString()).limit(100))
    for (const artifact of artifacts) {
      await query(db.storage.from(artifact.bucket).remove([artifact.path]))
      await query(db.from('creator_media_artifacts').delete().eq('path', artifact.path))
    }
    await query(db.from('creator_provider_events').delete().lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString()))
  } catch (e) { console.error('[creator-cleanup]', e.code || 'CLEANUP_ERROR') }
  finally { cleaning = false }
}
const recoveryTimer = setInterval(recover, 30000)
const cleanupTimer = setInterval(cleanup, 300000)
await recover()
await cleanup()
console.info(`[creator-worker] ${name} ready; concurrency=${concurrency}`)
async function shutdown() {
  clearInterval(recoveryTimer); clearInterval(cleanupTimer)
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ } }
  await worker.close()
  await closeQueues()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
