import { AppError } from './errors.js'

const REDIS_RATE_LIMIT_DISABLED = { value: false, reason: '' }
let redisRateLimitClientPromise = null

export function normalizeOrigin(value = '') {
  const raw = String(value || '').trim().replace(/^['"]|['"]$/g, '')
  if (!raw) {
    return ''
  }

  try {
    return new URL(raw).origin
  } catch {
    return raw.replace(/\/+$/, '')
  }
}

export function createClientOrigins({
  clientOrigin = 'http://localhost:8080',
  clientOrigins,
  defaultAllowedOrigins = [],
} = {}) {
  const configuredOrigins = [clientOrigins, clientOrigin, ...defaultAllowedOrigins]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => normalizeOrigin(value))
    .filter(Boolean)

  return Array.from(new Set(configuredOrigins))
}

export function createSecurityHeaders({ isProduction = false } = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
    }
    next()
  }
}

function isRedisRateLimitEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.ENABLE_REDIS_RATE_LIMIT || 'true').trim().toLowerCase(),
  )
}

async function getRedisRateLimitClient() {
  const redisRateLimitUrl = String(process.env.REDIS_URL || '').trim()
  if (!isRedisRateLimitEnabled() || !redisRateLimitUrl || REDIS_RATE_LIMIT_DISABLED.value) {
    return null
  }

  if (!redisRateLimitClientPromise) {
    redisRateLimitClientPromise = (async () => {
      try {
        const redisModule = await import('redis')
        const client = redisModule.createClient({ url: redisRateLimitUrl })
        client.on('error', (error) => {
          if (!REDIS_RATE_LIMIT_DISABLED.value) {
            REDIS_RATE_LIMIT_DISABLED.value = true
            REDIS_RATE_LIMIT_DISABLED.reason = error?.message || 'redis-client-error'
            console.warn('[rate-limit] redis disabled:', REDIS_RATE_LIMIT_DISABLED.reason)
          }
        })
        await client.connect()
        return client
      } catch (error) {
        REDIS_RATE_LIMIT_DISABLED.value = true
        REDIS_RATE_LIMIT_DISABLED.reason = error?.message || 'redis-init-failed'
        console.warn('[rate-limit] redis disabled:', REDIS_RATE_LIMIT_DISABLED.reason)
        return null
      }
    })()
  }

  return redisRateLimitClientPromise
}

export function getClientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || 'unknown')
    .split(',')[0]
    .trim() || 'unknown'
}

export function getDefaultRateLimitIdentity(req) {
  return {
    key: getClientIp(req),
    type: 'ip',
  }
}

export function createRateLimiter({ windowMs, max, keyPrefix = 'global', keyResolver = getDefaultRateLimitIdentity }) {
  const counters = new Map()

  return async function rateLimiter(req, _res, next) {
    const now = Date.now()
    const identity = keyResolver(req) || getDefaultRateLimitIdentity(req)
    const identityKey = String(identity.key || '').trim() || getClientIp(req)
    const identityType = String(identity.type || '').trim() || 'ip'
    const key = `${keyPrefix}:${identityType}:${identityKey}`

    req.rateLimit = {
      keyPrefix,
      keyType: identityType,
      key,
      windowMs,
      max,
    }

    const redisClient = await getRedisRateLimitClient()
    if (redisClient) {
      try {
        const count = await redisClient.incr(key)
        if (count === 1) {
          await redisClient.pExpire(key, windowMs)
        }
        if (count > max) {
          const ttlMs = await redisClient.pTTL(key)
          console.warn('[rate-limit] blocked', {
            requestId: req.requestId,
            stage: 'rate_limit',
            keyPrefix,
            keyType: identityType,
            userId: req.auth?.userId || null,
            ip: getClientIp(req),
            method: req.method,
            route: req.originalUrl,
            retryAfterMs: ttlMs > 0 ? ttlMs : windowMs,
          })
          next(
            new AppError('Too many requests. Please try again later.', {
              code: 'RATE_LIMITED',
              statusCode: 429,
              details: {
                retryAfterMs: ttlMs > 0 ? ttlMs : windowMs,
                keyType: identityType,
              },
            }),
          )
          return
        }
        next()
        return
      } catch (error) {
        console.warn('[rate-limit] redis check failed, fallback to memory:', error?.message || error)
      }
    }

    const current = counters.get(key)

    if (!current || now >= current.resetAt) {
      counters.set(key, {
        count: 1,
        resetAt: now + windowMs,
      })
      next()
      return
    }

    if (current.count >= max) {
      console.warn('[rate-limit] blocked', {
        requestId: req.requestId,
        stage: 'rate_limit',
        keyPrefix,
        keyType: identityType,
        userId: req.auth?.userId || null,
        ip: getClientIp(req),
        method: req.method,
        route: req.originalUrl,
        retryAfterMs: Math.max(current.resetAt - now, 0),
      })
      next(
        new AppError('Too many requests. Please try again later.', {
          code: 'RATE_LIMITED',
          statusCode: 429,
          details: {
            retryAfterMs: Math.max(current.resetAt - now, 0),
            keyType: identityType,
          },
        }),
      )
      return
    }

    current.count += 1
    counters.set(key, current)
    next()
  }
}
