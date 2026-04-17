import crypto from 'crypto'

const MEMORY_CACHE = new Map()
const REDIS_DISABLED = { value: false, reason: null }
let redisClientPromise = null

function parseBool(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) {
    return fallback
  }
  return text === '1' || text === 'true' || text === 'yes' || text === 'on'
}

function parseIntSafe(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const cacheConfig = {
  enableRedisCache: parseBool(process.env.ENABLE_REDIS_CACHE, false),
  redisUrl: String(process.env.REDIS_URL || '').trim(),
  enableAnalysisResultReuse: parseBool(process.env.ENABLE_ANALYSIS_RESULT_REUSE, true),
  analysisResultCacheTtlSeconds: parseIntSafe(process.env.ANALYSIS_RESULT_CACHE_TTL_SECONDS, 60 * 60 * 24),
  enableRagQueryCache: parseBool(process.env.ENABLE_RAG_QUERY_CACHE, true),
  ragQueryCacheTtlSeconds: parseIntSafe(process.env.RAG_QUERY_CACHE_TTL_SECONDS, 60 * 10),
}

function logCache(message, extra = {}) {
  const safe = Object.fromEntries(
    Object.entries(extra).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
  console.info(`[cache] ${message}`, safe)
}

function getMemoryCache(key) {
  const entry = MEMORY_CACHE.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= Date.now()) {
    MEMORY_CACHE.delete(key)
    return null
  }
  return entry.value
}

function setMemoryCache(key, value, ttlSeconds) {
  const expiresAt = Date.now() + ttlSeconds * 1000
  MEMORY_CACHE.set(key, {
    value,
    expiresAt,
  })
}

async function getRedisClient() {
  if (!cacheConfig.enableRedisCache || !cacheConfig.redisUrl) {
    return null
  }
  if (REDIS_DISABLED.value) {
    return null
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const redisModule = await import('redis')
        const client = redisModule.createClient({
          url: cacheConfig.redisUrl,
        })
        client.on('error', (error) => {
          if (!REDIS_DISABLED.value) {
            REDIS_DISABLED.value = true
            REDIS_DISABLED.reason = error?.message || 'redis-client-error'
            logCache('redis-disabled', { reason: REDIS_DISABLED.reason })
          }
        })
        await client.connect()
        logCache('redis-connected')
        return client
      } catch (error) {
        REDIS_DISABLED.value = true
        REDIS_DISABLED.reason = error?.message || 'redis-init-failed'
        logCache('redis-disabled', { reason: REDIS_DISABLED.reason })
        return null
      }
    })()
  }

  return redisClientPromise
}

export function buildCacheKey(namespace, payload) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
  return `v1:${namespace}:${digest}`
}

export function hashText(value = '') {
  const payload = Buffer.isBuffer(value) ? value : String(value)
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export async function getCacheJson(key) {
  const memory = getMemoryCache(key)
  if (memory !== null) {
    logCache('hit:memory', { key })
    return memory
  }

  const client = await getRedisClient()
  if (!client) {
    logCache('miss', { key, layer: 'memory-only' })
    return null
  }

  try {
    const raw = await client.get(key)
    if (!raw) {
      logCache('miss', { key, layer: 'redis' })
      return null
    }
    const parsed = JSON.parse(raw)
    logCache('hit:redis', { key })
    return parsed
  } catch (error) {
    logCache('miss', { key, layer: 'redis-error', error: error?.message })
    return null
  }
}

export async function setCacheJson(key, value, ttlSeconds) {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    return
  }

  setMemoryCache(key, value, ttlSeconds)

  const client = await getRedisClient()
  if (!client) {
    return
  }

  try {
    await client.set(key, JSON.stringify(value), {
      EX: ttlSeconds,
    })
    logCache('set', { key, ttlSeconds })
  } catch (error) {
    logCache('set-failed', { key, error: error?.message })
  }
}
