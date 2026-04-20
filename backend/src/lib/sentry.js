import crypto from 'node:crypto'
import * as Sentry from '@sentry/node'

const ignoredPatterns = [
  'AbortError',
  'ECONNRESET',
  'socket hang up',
]

const SENSITIVE_KEY_PATTERN = /password|token|authorization|secret|api[-_]?key|cookie|session/i

function sanitizeContextPayload(value, depth = 0) {
  if (depth > 3) {
    return '[TRUNCATED]'
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeContextPayload(item, depth + 1))
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > 600) {
      return `${value.slice(0, 600)}…`
    }
    return value
  }

  const next = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      next[key] = '[REDACTED]'
      continue
    }
    next[key] = sanitizeContextPayload(item, depth + 1)
  }
  return next
}

function getSentryConfig() {
  const environment = process.env.NODE_ENV || 'development'
  const dsn = process.env.SENTRY_DSN
  const release = process.env.APP_RELEASE || 'local-dev'
  const tracesSampleRate = environment === 'production' ? 0.2 : 1.0

  return {
    environment,
    dsn,
    release,
    tracesSampleRate,
  }
}

export function initBackendSentry() {
  const { dsn, environment, release, tracesSampleRate } = getSentryConfig()

  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event, hint) {
      const originalError = hint.originalException

      if (
        originalError instanceof Error &&
        ignoredPatterns.some((pattern) => originalError.message.includes(pattern))
      ) {
        return null
      }

      const message = event.exception?.values?.[0]?.value || event.message || ''
      if (ignoredPatterns.some((pattern) => message.includes(pattern))) {
        return null
      }

      return event
    },
  })
}

export function attachSentryRequestContext(req, _res, next) {
  const { dsn } = getSentryConfig()
  req.requestId = crypto.randomUUID()

  if (dsn) {
    Sentry.setTag('service', 'backend')
    Sentry.setTag('request_id', req.requestId)
    Sentry.setContext('http', {
      method: req.method,
      url: req.originalUrl,
      query: req.query,
    })
    Sentry.addBreadcrumb({
      category: 'http',
      message: `${req.method} ${req.originalUrl}`,
      level: 'info',
    })
  }

  next()
}

export function captureExceptionWithRequest(error, req, _res, next) {
  const { dsn } = getSentryConfig()

  if (!dsn) {
    next(error)
    return
  }

  Sentry.withScope((scope) => {
    scope.setTag('request_id', req.requestId)
    scope.setTag('error_code', error.code || 'UNHANDLED_ERROR')
    scope.setContext('request', {
      method: req.method,
      path: req.originalUrl,
      params: sanitizeContextPayload(req.params),
      query: sanitizeContextPayload(req.query),
      body: sanitizeContextPayload(req.body),
    })

    Sentry.captureException(error)
  })

  next(error)
}
