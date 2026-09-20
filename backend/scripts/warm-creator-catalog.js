import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdir, open, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Redis from 'ioredis'
import { database } from '../src/creator-tools/store.js'
import { redisConnection } from '../src/creator-tools/queue.js'
import { createProviders } from '../src/creator-tools/providers.js'
import { discoverAccounts } from '../src/creator-tools/discovery.js'
import { REFERENCE_CATEGORIES } from '../src/creator-tools/categories.js'
import { reviewRecord } from '../src/creator-tools/reference-catalog.js'
import { seedPlan, createSeedBudget, requireSeedApproval } from '../src/creator-tools/reference-seed-budget.js'

dotenv.config({ path:fileURLToPath(new URL('../../.env', import.meta.url)), quiet:true })
dotenv.config({ path:fileURLToPath(new URL('../../.env.creator-tools', import.meta.url)), override:true, quiet:true })

const args = process.argv.slice(2)
const selected = args.find(value => value.startsWith('--category='))?.slice('--category='.length)
const categories = args.includes('--all') ? REFERENCE_CATEGORIES : REFERENCE_CATEGORIES.includes(selected) ? [selected] : []
if (!categories.length) {
  console.error('Usage: npm run warm-creator-catalog -- --category="살림/인테리어" [--output-dir=output/catalog-review] [--execute --approve=<plan-id>] [--local] | --all')
  process.exitCode = 1
} else {
  try {
    const plan = seedPlan(categories)
    console.log(JSON.stringify(plan, null, 2))
    if (!args.includes('--execute')) console.log(`Estimate only. No connections or paid calls. Approval requires --execute --approve=${plan.approval}`)
    else {
      requireSeedApproval(args, plan)
      if (args.includes('--local')) {
        // Resolve secrets in memory after dotenv; never let saved remote settings override this mode.
        let local
        try { local = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {
          cwd:fileURLToPath(new URL('../../', import.meta.url)), encoding:'utf8', stdio:['ignore','pipe','ignore'], timeout:15000,
        })) } catch { throw new Error('Local Supabase status unavailable; no paid call made') }
        const url = new URL(local.API_URL)
        if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || !local.SERVICE_ROLE_KEY) {
          throw new Error('Local mode requires loopback Supabase; no paid call made')
        }
        Object.assign(process.env, { SUPABASE_URL:local.API_URL, SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,
          SUPABASE_CA_CERT_PATH:'', SUPABASE_TLS_INSECURE:'false', CREATOR_REDIS_URL:'redis://127.0.0.1:56379' })
      }
      const userId = String(process.env.CREATOR_META_SERVICE_USER_ID || '').trim()
      if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('CREATOR_META_SERVICE_USER_ID is required for catalog collection')
      const reusePath = args.find(value => value.startsWith('--search-checkpoints='))?.slice('--search-checkpoints='.length)
      const reuse = reusePath ? JSON.parse(await readFile(reusePath, 'utf8')) : null
      if (reuse && (categories.length !== 1 || reuse.category !== categories[0] || reuse.qualityVersion !== plan.qualityVersion)) {
        throw new Error('Search checkpoints must match one category and the current quality version')
      }
      const output = resolve(args.find(value => value.startsWith('--output-dir='))?.slice('--output-dir='.length) || 'output/catalog-review')
      await mkdir(output, { recursive:true })
      const redis = new Redis({ ...redisConnection(), maxRetriesPerRequest:1 })
      const db = database(), controller = new AbortController()
      const cancel = () => controller.abort()
      process.once('SIGINT', cancel)
      try {
        for (const category of categories) {
          const file = resolve(output, `${category.replace(/\//g, '-')}-${Date.now()}.json`)
          const handle = await open(file, 'wx', 0o600)
          const budget = createSeedBudget(plan, controller.signal), values = new Map(), review = new Map()
          // Only reuse search identities. Receipt/batch associations can change when the pool changes.
          for (const [name, result] of Object.entries(reuse?.checkpoints || {})) {
            if (/^accountSearchV9-\d+-\d+$/.test(name) && Array.isArray(result)
              && result.every(value => typeof value === 'string' && /^[a-zA-Z0-9_.]{1,30}$/.test(value))) values.set(name, result)
          }
          try {
            const job = { id:null, user_id:userId, input:{ category, accountSize:'any', faceVisibility:'any', contentFormat:'any',
              recentActivity:'any', contentLanguage:'ko', region:'KR', excludeAccounts:[] } }
            const ctx = { db, redis, job, signal:controller.signal, beforeCall:budget.beforeCall,
              stage:async name => { if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code:'SEED_CANCELLED' }); console.log(`[catalog] ${category}: ${name}`) },
              checkpoint:async (name, fn) => {
                if (values.has(name)) return values.get(name)
                try {
                  const value = await fn()
                  values.set(name, value)
                  await writeFile(`${file}.checkpoints.json`, JSON.stringify({ category, qualityVersion:plan.qualityVersion,
                    checkpoints:Object.fromEntries(values) }, null, 2), { mode:0o600 })
                  console.log(JSON.stringify({ checkpoint:name, records:Array.isArray(value) ? value.length : null }))
                  return value
                } catch (error) {
                  console.log(JSON.stringify({ checkpoint:name, httpStatus:error.status || null, code:error.code || 'CHECKPOINT_FAILED' }))
                  if ([400,401,403,404].includes(error.status)) error.code = 'SEED_PROVIDER_CONFIG'
                  throw error
                }
              },
              reviewEvidence:async rows => { for (const row of rows) review.set(row.username, reviewRecord(row, null, category)) },
              reviewCandidates:async (rows, ranks) => { for (const row of rows) review.set(row.username, reviewRecord(row, ranks.get(row.username), category)) } }
            ctx.providers = createProviders({ ...ctx, referencePollMs:Number(process.env.CREATOR_CATALOG_POLL_MS || 30000) })
            await discoverAccounts(ctx)
          } finally {
            await handle.writeFile(JSON.stringify([...review.values()], null, 2) + '\n')
            await handle.close()
            console.log(JSON.stringify({ category, file, candidates:review.size, ...budget.summary(), reviewedByOperator:false }))
          }
        }
      } finally { process.removeListener('SIGINT', cancel); await redis.quit() }
    }
  } catch (error) {
    // Never print provider response bodies or environment values.
    console.error(error.code ? `Catalog collection stopped: ${error.code}` : error.message)
    process.exitCode = 1
  }
}
