import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAccount, deleteAccount, listAccounts, resolveRequestAccount } from './lib/accounts.js'
import { getAccountProfile, upsertAccountProfile } from './lib/account-profile.js'
import { getAccountCharacterContext } from './lib/account-character.js'
import { requireAuth, requireAdmin } from './lib/auth.js'
import { getOpenAIModels, hasOpenAIConfig } from './lib/openai.js'
import {
  buildPersonalizationContext,
  updatePersonalizationMemory,
} from './lib/personalization-memory.js'
import { hasSupabaseAdminConfig } from './lib/supabase.js'
import { AppError, asyncHandler, errorHandler, notFoundHandler } from './lib/errors.js'
import { answerQuestion } from './lib/answer.js'
import {
  getAdminOverview,
  getAdminPdfDocumentDetail,
  listAdminPdfDocuments,
} from './lib/admin.js'
import { ingestDocument } from './lib/document-ingest.js'
import { ingestPdfDocument } from './lib/pdf-ingest.js'
import { classifyCopilotIntent, generateScriptFeedback, refineScriptWithAI } from './lib/script-assistant.js'
import { generateCaptionDraft } from './lib/caption-generator.js'
import { getCaptionCategoryRule } from './lib/caption-category-rules.js'
import { analyzeThumbnailImage, generateThumbnailTitles } from './lib/thumbnail-title.js'
import {
  createScriptFromSelection,
  listScriptVersions,
  restoreScriptVersion,
  saveFeedbackRecord,
  saveScriptVersion,
} from './lib/script-storage.js'
import {
  getDocumentWithChunks,
  listDocuments,
  searchChunks,
} from './lib/document-query.js'
import {
  analyzeReferenceVideo,
  deleteReferenceVideo,
  getReferenceVideo,
  listReferenceVideos,
  updateReferenceVideo,
} from './lib/reference-video-analysis.js'
import { createProject, deleteProject, listProjects } from './lib/projects.js'
import {
  attachSentryRequestContext,
  captureExceptionWithRequest,
  initBackendSentry,
} from './lib/sentry.js'
import { logAIError } from './lib/ai-error-logger.js'
import { assertBackendEnv } from './lib/env-validation.js'
import {
  applyCouponToUser,
  assertEntitlementAccess,
  assertUsageAllowed,
  getUserEntitlementStatus,
  recordUsageEvent,
} from './lib/entitlements.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Deploy trigger: backend touchpoint.
// Comment-only test change for direct main push.
// Railway redeploy check: backend service touchpoint.
dotenv.config({ path: resolve(__dirname, '../../.env') })
assertBackendEnv()

const app = express()
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:4173',
  'https://www.hookai.kr',
  'https://hookai.kr',
]

function normalizeOrigin(value = '') {
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

const configuredOrigins = [process.env.CLIENT_ORIGINS, clientOrigin, ...defaultAllowedOrigins]
  .filter(Boolean)
  .flatMap((value) => String(value).split(','))
  .map((value) => normalizeOrigin(value))
  .filter(Boolean)

const clientOrigins = Array.from(new Set(configuredOrigins))
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
})
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, os.tmpdir())
    },
    filename: (_req, file, callback) => {
      const extensionMatch = String(file.originalname || '').match(/(\.[a-z0-9]+)$/i)
      const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '.mp4'
      callback(null, `hookai-video-${Date.now()}-${randomUUID()}${extension}`)
    },
  }),
  limits: {
    fileSize: 300 * 1024 * 1024,
  },
})
const isProduction = (process.env.NODE_ENV || 'development') === 'production'
const enableTestRoutes = process.env.ENABLE_TEST_ROUTES === 'true'
const enableRedisRateLimit = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.ENABLE_REDIS_RATE_LIMIT || 'true').trim().toLowerCase(),
)
const redisRateLimitUrl = String(process.env.REDIS_URL || '').trim()
const REDIS_RATE_LIMIT_DISABLED = { value: false, reason: '' }
let redisRateLimitClientPromise = null

function securityHeaders(_req, res, next) {
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

async function getRedisRateLimitClient() {
  if (!enableRedisRateLimit || !redisRateLimitUrl || REDIS_RATE_LIMIT_DISABLED.value) {
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

function getClientIp(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || 'unknown')
    .split(',')[0]
    .trim() || 'unknown'
}

function getDefaultRateLimitIdentity(req) {
  return {
    key: getClientIp(req),
    type: 'ip',
  }
}

function createRateLimiter({ windowMs, max, keyPrefix = 'global', keyResolver = getDefaultRateLimitIdentity }) {
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

function bytesAt(buffer, offset, bytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length < offset + bytes.length) {
    return false
  }
  return bytes.every((value, index) => buffer[offset + index] === value)
}

function isPdfByMagicBytes(buffer) {
  return bytesAt(buffer, 0, [0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
}

function isVideoByMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false
  }

  const isIsoBmffFamily = String(buffer.subarray(4, 8)) === 'ftyp' // mp4/mov/m4v
  if (isIsoBmffFamily) return true

  const isMatroskaFamily = bytesAt(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3]) // webm/mkv
  if (isMatroskaFamily) return true

  const isAvi =
    String(buffer.subarray(0, 4)) === 'RIFF' &&
    String(buffer.subarray(8, 12)) === 'AVI ' // avi
  return isAvi
}

async function readMagicBytesFromUpload(file, size = 64) {
  if (!file) {
    return Buffer.alloc(0)
  }

  if (Buffer.isBuffer(file.buffer) && file.buffer.length > 0) {
    return file.buffer.subarray(0, size)
  }

  if (typeof file.path === 'string' && file.path) {
    const fsModule = await import('node:fs/promises')
    const handle = await fsModule.open(file.path, 'r')
    try {
      const buffer = Buffer.alloc(size)
      const { bytesRead } = await handle.read(buffer, 0, size, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  return Buffer.alloc(0)
}

async function removeUploadedTempFile(file) {
  if (!file?.path) {
    return
  }

  try {
    await rm(file.path, { force: true })
  } catch {
    // ignore cleanup failures for temp files
  }
}

async function validateUploadedFile(file, {
  fieldName,
  allowedMimePrefixes = [],
  allowedMimeTypes = [],
  allowedExtensions = [],
  magicType = null,
}) {
  if (!file) {
    throw new AppError(`${fieldName} file is required`, {
      code: 'FILE_REQUIRED',
      statusCode: 400,
      details: { fieldName },
    })
  }

  const mimeType = String(file.mimetype || '').toLowerCase()
  const fileName = String(file.originalname || '').toLowerCase()
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

  const allowedByExactMime = allowedMimeTypes.some((item) => item.toLowerCase() === mimeType)
  const allowedByPrefix = allowedMimePrefixes.some((prefix) => mimeType.startsWith(prefix.toLowerCase()))
  const allowedByExtension = allowedExtensions.some((ext) => ext.toLowerCase() === extension)

  if (!allowedByExactMime && !allowedByPrefix && !allowedByExtension) {
    throw new AppError(`Unsupported ${fieldName} file type`, {
      code: 'UNSUPPORTED_FILE_TYPE',
      statusCode: 400,
      details: {
        fieldName,
        mimeType,
        extension,
      },
    })
  }

  const magicBytes = magicType ? await readMagicBytesFromUpload(file, 64) : null

  if (magicType === 'pdf' && !isPdfByMagicBytes(magicBytes)) {
    throw new AppError(`Unsupported ${fieldName} file signature`, {
      code: 'INVALID_FILE_SIGNATURE',
      statusCode: 400,
      details: { fieldName, expected: 'pdf' },
    })
  }

  if (magicType === 'video' && !isVideoByMagicBytes(magicBytes)) {
    throw new AppError(`Unsupported ${fieldName} file signature`, {
      code: 'INVALID_FILE_SIGNATURE',
      statusCode: 400,
      details: { fieldName, expected: 'video-container' },
    })
  }
}

function getUploadLogContext(req, file = req.file) {
  const fileName = String(file?.originalname || '')
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

  return {
    requestId: req.requestId,
    userId: req.auth?.userId || null,
    accountId: req.body?.accountId || req.headers['x-account-id'] || null,
    ip: getClientIp(req),
    userAgent: req.headers['user-agent'] || '',
    fileName: fileName || null,
    fileSize: Number(file?.size || 0),
    mimeType: file?.mimetype || null,
    extension: extension || null,
    contentLength: req.headers['content-length'] || null,
    asyncProcessing: req.body?.asyncProcessing || null,
    rateLimitKeyType: req.rateLimit?.keyType || null,
  }
}

function logReferenceUploadStage(req, stage, extra = {}) {
  console.info('[reference-upload]', {
    stage,
    ...getUploadLogContext(req),
    ...extra,
  })
}

function readString(value, { field, maxLength = 2000, required = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) {
    if (required) {
      throw new AppError(`${field} is required`, {
        code: 'INVALID_INPUT',
        statusCode: 400,
        details: { field },
      })
    }
    return ''
  }

  if (normalized.length > maxLength) {
    throw new AppError(`${field} is too long`, {
      code: 'INVALID_INPUT',
      statusCode: 400,
      details: { field, maxLength },
    })
  }

  return normalized
}

function readRequestCharacterId(req) {
  return readString(
    req.body?.characterId ||
      req.body?.character_id ||
      req.query?.characterId ||
      req.query?.character_id ||
      req.headers['x-character-id'],
    {
      field: 'characterId',
      maxLength: 80,
    },
  )
}

function readTextList(value, { maxItems = 12 } = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems)
  }

  if (typeof value === 'string') {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, maxItems)
  }

  return []
}

function readNumber(value, { field, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${field} is invalid`, {
      code: 'INVALID_INPUT',
      statusCode: 400,
      details: { field, min, max },
    })
  }

  return parsed
}

const askRateLimiter = createRateLimiter({ windowMs: 60_000, max: 60, keyPrefix: 'ask' })
const refineRateLimiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: 'refine' })
const feedbackRateLimiter = createRateLimiter({ windowMs: 60_000, max: 40, keyPrefix: 'feedback' })
const analyzeRateLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 8,
  keyPrefix: 'analyze',
  keyResolver: (req) => {
    const userId = String(req.auth?.userId || '').trim()
    if (userId) {
      return {
        key: userId,
        type: 'user',
      }
    }
    return getDefaultRateLimitIdentity(req)
  },
})
const searchRateLimiter = createRateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'search' })

initBackendSentry()

app.disable('x-powered-by')
app.use(securityHeaders)
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true)
        return
      }

      if (clientOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS blocked for origin: ${origin}`))
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(attachSentryRequestContext)

app.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Backend is running',
  })
})

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'healthy',
  })
})

app.get('/api/health', (_req, res) => {
  if (!isProduction) {
    const { chatModel, embeddingModel } = getOpenAIModels()
    res.json({
      status: 'ok',
      message: 'Express API is running',
      openaiConfigured: hasOpenAIConfig(),
      openaiModels: {
        chatModel,
        embeddingModel,
      },
      supabaseAdminConfigured: hasSupabaseAdminConfig(),
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    })
    return
  }

  res.json({
    status: 'ok',
    message: 'healthy',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api', requireAuth)
app.use('/api/admin', requireAdmin)

app.get(
  '/api/entitlements/me',
  asyncHandler(async (req, res) => {
    const status = await getUserEntitlementStatus({
      userId: req.auth?.userId,
      referenceId: req.query?.referenceId || null,
    })

    res.json(status)
  }),
)

app.post(
  '/api/coupons/apply',
  asyncHandler(async (req, res) => {
    const status = await applyCouponToUser({
      userId: req.auth?.userId,
      couponCode: req.body?.couponCode || req.body?.coupon_code,
    })

    res.status(201).json({
      message: '이용권이 활성화되었습니다.',
      ...status,
    })
  }),
)

app.post(
  '/api/tools/caption',
  asyncHandler(async (req, res) => {
    await assertEntitlementAccess({ userId: req.auth?.userId })
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const profileSettings = character.profile?.settings && typeof character.profile.settings === 'object'
      ? character.profile.settings
      : {}
    const requestCategory = readString(req.body?.category, {
      field: 'category',
      maxLength: 100,
    })
    const accountCategory = profileSettings.category || character.profile?.category || requestCategory || ''
    const categoryRule = await getCaptionCategoryRule(accountCategory)
    const result = await generateCaptionDraft({
      accountId: account.id,
      topic: readString(req.body?.topic, {
        field: 'topic',
        maxLength: 500,
      }),
      captionA: readString(req.body?.captionA || req.body?.caption_a, {
        field: 'captionA',
        maxLength: 5000,
      }),
      captionB: readString(req.body?.captionB || req.body?.caption_b, {
        field: 'captionB',
        maxLength: 5000,
      }),
      monetizationModel: readString(req.body?.monetizationModel || req.body?.monetization_model, {
        field: 'monetizationModel',
        maxLength: 100,
      }),
      category: accountCategory,
      categoryRule,
      strategyText: readString(req.body?.strategyText || req.body?.strategy_text, {
        field: 'strategyText',
        maxLength: 2000,
      }),
      hookDirection: Array.isArray(req.body?.hookDirection || req.body?.hook_direction)
        ? (req.body?.hookDirection || req.body?.hook_direction).slice(0, 8).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      bodyFocus: Array.isArray(req.body?.bodyFocus || req.body?.body_focus)
        ? (req.body?.bodyFocus || req.body?.body_focus).slice(0, 8).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      ctaExamples: Array.isArray(req.body?.ctaExamples || req.body?.cta_examples)
        ? (req.body?.ctaExamples || req.body?.cta_examples).slice(0, 8).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      riskNotes: Array.isArray(req.body?.riskNotes || req.body?.risk_notes)
        ? (req.body?.riskNotes || req.body?.risk_notes).slice(0, 8).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      bannedExpressions: Array.isArray(req.body?.bannedExpressions || req.body?.banned_expressions)
        ? (req.body?.bannedExpressions || req.body?.banned_expressions).slice(0, 8).map((item) => String(item || '').trim()).filter(Boolean)
        : [],
      accountBannedExpressions: readTextList(profileSettings.forbiddenExpressions || profileSettings.bannedPhrases),
      characterSystemPrompt: character.systemPrompt,
    })

    res.json(result)
  }),
)

app.get(
  '/api/tools/caption/category-rule',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false, query: true })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const profileSettings = character.profile?.settings && typeof character.profile.settings === 'object'
      ? character.profile.settings
      : {}
    const requestCategory = readString(req.query?.category, {
      field: 'category',
      maxLength: 100,
    })
    const accountCategory = profileSettings.category || character.profile?.category || requestCategory || ''
    const categoryRule = await getCaptionCategoryRule(accountCategory)

    res.json({
      category: accountCategory,
      rule: categoryRule,
    })
  }),
)

app.post(
  '/api/tools/thumbnail/analyze',
  uploadImage.single('image'),
  asyncHandler(async (req, res) => {
    await assertEntitlementAccess({ userId: req.auth?.userId })
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const profileSettings = character.profile?.settings && typeof character.profile.settings === 'object'
      ? character.profile.settings
      : {}
    await validateUploadedFile(req.file, {
      fieldName: 'thumbnail',
      allowedMimePrefixes: ['image/'],
      allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    })

    const voiceTones = readTextList(profileSettings.voiceTones || profileSettings.voiceTone || character.profile?.tone, {
      maxItems: 6,
    })
    const result = await analyzeThumbnailImage({
      imageBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
      topic: readString(req.body?.topic, {
        field: 'topic',
        maxLength: 500,
      }),
      category: profileSettings.category || character.profile?.category || '',
      tone: voiceTones.join(', '),
    })

    res.json({
      analysis: result,
      appliedInputs: {
        accountCategory: profileSettings.category || character.profile?.category || '',
        accountTone: voiceTones,
      },
    })
  }),
)

app.post(
  '/api/tools/thumbnail/titles',
  asyncHandler(async (req, res) => {
    await assertEntitlementAccess({ userId: req.auth?.userId })
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const profileSettings = character.profile?.settings && typeof character.profile.settings === 'object'
      ? character.profile.settings
      : {}
    const voiceTones = readTextList(profileSettings.voiceTones || profileSettings.voiceTone || character.profile?.tone, {
      maxItems: 6,
    })
    const result = await generateThumbnailTitles({
      topic: readString(req.body?.topic, {
        field: 'topic',
        maxLength: 500,
        required: true,
      }),
      category: profileSettings.category || character.profile?.category || '',
      tone: voiceTones.join(', '),
      imageAnalysis: req.body?.imageAnalysis && typeof req.body.imageAnalysis === 'object'
        ? req.body.imageAnalysis
        : {},
      characterSystemPrompt: character.systemPrompt,
    })

    res.json(result)
  }),
)

app.get(
  '/api/accounts',
  asyncHandler(async (_req, res) => {
    const accounts = await listAccounts(_req.auth?.userId, _req.auth?.email)

    res.json({
      accounts,
      count: accounts.length,
    })
  }),
)

app.post(
  '/api/accounts',
  asyncHandler(async (req, res) => {
    const account = await createAccount({
      name: req.body?.name,
      slug: req.body?.slug,
    }, req.auth?.userId)

    res.status(201).json({
      account,
    })
  }),
)

app.delete(
  '/api/accounts/:id',
  asyncHandler(async (req, res) => {
    const account = await deleteAccount(req.params.id, req.auth?.userId)

    res.json({
      message: 'Account deleted',
      account,
    })
  }),
)

app.get(
  '/api/account/profile',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const profile = await getAccountProfile(account.id)

    res.json({
      account,
      profile,
    })
  }),
)

app.put(
  '/api/account/profile',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const profile = await upsertAccountProfile(account.id, {
      tone: req.body?.tone,
      persona: req.body?.persona,
      targetAudience: req.body?.targetAudience,
      goal: req.body?.goal,
      strategy: req.body?.strategy,
      accountName: req.body?.accountName,
      settings: req.body?.settings,
    }, req.auth?.userId)

    res.json({
      message: 'Account profile saved',
      account,
      profile,
    })
  }),
)

app.get(
  '/api/admin/overview',
  asyncHandler(async (_req, res) => {
    const overview = await getAdminOverview()
    const { chatModel, embeddingModel } = getOpenAIModels()

    res.json({
      status: 'ok',
      services: {
        openaiConfigured: hasOpenAIConfig(),
        supabaseAdminConfigured: hasSupabaseAdminConfig(),
        chatModel,
        embeddingModel,
      },
      overview,
      timestamp: new Date().toISOString(),
    })
  }),
)

app.get(
  '/api/admin/documents',
  asyncHandler(async (req, res) => {
    const documents = await listAdminPdfDocuments()

    res.json({
      documents,
      count: documents.length,
    })
  }),
)

app.get(
  '/api/admin/documents/:id',
  asyncHandler(async (req, res) => {
    const document = await getAdminPdfDocumentDetail(req.params.id)

    res.json({
      document,
      chunkCount: document.chunkCount,
    })
  }),
)

app.post(
  '/api/documents/ingest',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const { title, content, source, metadata } = req.body ?? {}
    const result = await ingestDocument({
      accountId: account.id,
      title,
      content,
      source,
      metadata,
    })

    res.status(201).json({
      message: 'Document ingested successfully',
      document: result.document,
      chunkCount: result.chunkCount,
      chunks: result.chunks,
    })
  }),
)

app.post(
  '/api/documents/ingest-pdf',
  uploadPdf.single('pdf'),
  asyncHandler(async (req, res) => {
    await validateUploadedFile(req.file, {
      fieldName: 'pdf',
      allowedMimeTypes: ['application/pdf'],
      allowedExtensions: ['pdf'],
      magicType: 'pdf',
    })
    const account = await resolveRequestAccount(req)
    const { title, source } = req.body ?? {}
    const result = await ingestPdfDocument({
      file: req.file,
      accountId: account.id,
      title,
      source,
    })

    res.status(201).json({
      message: 'PDF ingested successfully',
      document: result.document,
      chunkCount: result.chunkCount,
      chunks: result.chunks,
    })
  }),
)

app.get(
  '/api/reference-videos',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const items = await listReferenceVideos(account.id)

    res.json({
      items,
      count: items.length,
    })
  }),
)

app.patch(
  '/api/reference-videos/:id',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const updated = await updateReferenceVideo(req.params.id, account.id, {
      title: req.body?.title,
      projectId: req.body?.projectId,
    })

    res.json({
      message: 'Reference video updated',
      item: updated,
    })
  }),
)

app.get(
  '/api/reference-videos/:id',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const analysis = await getReferenceVideo(req.params.id, account.id)

    res.json({
      analysis,
    })
  }),
)

app.delete(
  '/api/reference-videos/:id',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const deleted = await deleteReferenceVideo(req.params.id, account.id)

    res.json({
      message: 'Reference video deleted',
      item: deleted,
    })
  }),
)

app.get(
  '/api/projects',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const projects = await listProjects(account.id)

    res.json({
      items: projects,
      count: projects.length,
    })
  }),
)

app.post(
  '/api/projects',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const project = await createProject({
      accountId: account.id,
      name: req.body?.name,
    })

    res.status(201).json({
      item: project,
    })
  }),
)

app.delete(
  '/api/projects/:id',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const deleted = await deleteProject({
      accountId: account.id,
      projectId: req.params.id,
    })

    res.json({
      message: 'Project deleted',
      item: deleted,
    })
  }),
)

app.post(
  '/api/reference-videos/analyze',
  analyzeRateLimiter,
  uploadVideo.single('video'),
  asyncHandler(async (req, res) => {
    logReferenceUploadStage(req, 'file_validation', { status: 'start' })
    try {
      await validateUploadedFile(req.file, {
        fieldName: 'video',
        allowedMimePrefixes: ['video/'],
        allowedExtensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'],
        magicType: 'video',
      })
      logReferenceUploadStage(req, 'file_validation', { status: 'success' })
    } catch (error) {
      logReferenceUploadStage(req, 'file_validation', {
        status: 'failed',
        errorCode: error.code || 'FILE_VALIDATION_FAILED',
        statusCode: error.statusCode || 400,
        message: error.message,
      })
      await removeUploadedTempFile(req.file)
      throw error
    }
    const account = await resolveRequestAccount(req)
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'reference_analysis',
    })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const analysisInput = {
      accountId: account.id,
      file: req.file,
      topic: req.body?.topic,
      title: req.body?.title,
      projectId: req.body?.projectId || null,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || '',
      characterSystemPrompt: character.systemPrompt,
      accountSettings:
        character?.profile?.settings && typeof character.profile.settings === 'object'
          ? character.profile.settings
          : {},
    }

    if (req.body?.asyncProcessing === '1' || req.body?.asyncProcessing === 'true') {
      logReferenceUploadStage(req, 'analysis_enqueue', {
        accountId: account.id,
        status: 'start',
      })
      let accepted = false
      let resolveAccepted
      let rejectAccepted
      const acceptedPromise = new Promise((resolve, reject) => {
        resolveAccepted = resolve
        rejectAccepted = reject
      })

      const analysisPromise = analyzeReferenceVideo({
        ...analysisInput,
        onProcessingCreated: async (processingReference) => {
          if (accepted) {
            return
          }
          logReferenceUploadStage(req, 'db_insert', {
            accountId: account.id,
            status: 'success',
            referenceId: processingReference?.id || null,
          })
          accepted = true
          resolveAccepted(processingReference)
        },
      })

      analysisPromise
        .then(async (result) => {
          await recordUsageEvent({
            userId: req.auth?.userId,
            entitlementId: usageStatus.entitlement.id,
            eventType: 'reference_analysis',
            referenceId: result?.id || null,
          })
        })
        .catch((error) => {
          if (!accepted) {
            rejectAccepted(error)
          }
          logReferenceUploadStage(req, 'analysis_processing', {
            accountId: account.id,
            status: 'failed',
            errorCode: error.code || 'ANALYSIS_FAILED',
            statusCode: error.statusCode || 500,
            message: error.message,
          })
          logAIError('analysis', error, {
            stage: 'async-reference-analysis',
            accountId: account.id,
          })
        })
        .finally(async () => {
          await removeUploadedTempFile(req.file)
        })

      const processingReference = await acceptedPromise
      logReferenceUploadStage(req, 'analysis_enqueue', {
        accountId: account.id,
        status: 'accepted',
        referenceId: processingReference?.id || null,
      })
      res.status(202).json({
        message: 'Reference video analysis accepted',
        analysis: processingReference,
      })
      return
    }

    try {
      const result = await analyzeReferenceVideo(analysisInput)
      await recordUsageEvent({
        userId: req.auth?.userId,
        entitlementId: usageStatus.entitlement.id,
        eventType: 'reference_analysis',
        referenceId: result?.id || null,
      })

      res.status(201).json({
        message: 'Reference video analyzed successfully',
        analysis: result,
      })
    } finally {
      await removeUploadedTempFile(req.file)
    }
  }),
)

app.get(
  '/api/documents',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const documents = await listDocuments(account.id)

    res.json({
      documents,
      count: documents.length,
    })
  }),
)

app.get(
  '/api/documents/:id',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const document = await getDocumentWithChunks(req.params.id, account.id)

    res.json({
      document,
      chunkCount: document.chunks.length,
    })
  }),
)

app.post(
  '/api/search',
  searchRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const query = readString(req.body?.query, {
      field: 'query',
      required: true,
      maxLength: 2000,
    })
    const matchCount = readNumber(req.body?.matchCount, {
      field: 'matchCount',
      min: 1,
      max: 50,
      fallback: 10,
    })
    const results = await searchChunks({ query, accountId: account.id, matchCount })

    res.json({
      query,
      count: results.length,
      results,
    })
  }),
)

app.post(
  '/api/ask',
  askRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `ask:${account.id}`
    const query = readString(req.body?.query, {
      field: 'query',
      required: true,
      maxLength: 2000,
    })
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: `ask:${account.id}`,
      mode: 'ask',
      query,
    })
    const matchCount = readNumber(req.body?.matchCount, {
      field: 'matchCount',
      min: 1,
      max: 20,
      fallback: 5,
    })
    const result = await answerQuestion({
      query,
      accountId: account.id,
      matchCount,
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: query,
      assistantOutput: result.answer,
      fallbackSession: `ask:${account.id}`,
      mode: 'ask',
      source: 'ask',
    })

    res.json({
      query,
      answer: result.answer,
      model: result.model,
      contextCount: result.contextResults.length,
      contextResults: result.contextResults,
      personalization: {
        sessionId: personalization.sessionId,
        snapshot: personalization.snapshot,
        memoryUpdate,
        note:
          '이번 답변은 계정 고정 규칙 + 최근 세션 메모리를 반영했습니다.',
      },
    })
  }),
)

app.post(
  '/api/scripts',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const result = await createScriptFromSelection({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      title: req.body?.title,
      sections: req.body?.sections,
      score: req.body?.score ?? null,
    })

    res.status(201).json(result)
  }),
)

app.get(
  '/api/scripts/:id/versions',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const versions = await listScriptVersions(account.id, req.params.id)

    res.json({ versions })
  }),
)

app.post(
  '/api/scripts/:id/versions',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const result = await saveScriptVersion({
      accountId: account.id,
      scriptId: req.params.id,
      title: req.body?.title,
      sections: req.body?.sections,
      versionType: req.body?.versionType,
      score: req.body?.score ?? null,
      metadata: req.body?.metadata ?? {},
    })

    res.status(201).json(result)
  }),
)

app.post(
  '/api/scripts/:id/restore',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const result = await restoreScriptVersion({
      accountId: account.id,
      scriptId: req.params.id,
      versionId: req.body?.versionId,
    })

    res.json(result)
  }),
)

app.post(
  '/api/scripts/copilot',
  refineRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const requestText = readString(req.body?.message || req.body?.request, {
      field: 'message',
      required: true,
      maxLength: 3000,
    })
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `copilot:${account.id}:${req.body?.referenceId || 'general'}`
    const copilotFallbackSession = `copilot:${account.id}:${req.body?.referenceId || 'general'}`
    const intentPersonalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: copilotFallbackSession,
      mode: 'default',
      query: requestText,
    })
    const intent = await classifyCopilotIntent({
      message: requestText,
      sections: req.body?.sections,
      editTarget: req.body?.editTarget || req.body?.edit_target || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: intentPersonalization.context,
    })

    if (intent.intent === 'feedback_request') {
      const personalization = await buildPersonalizationContext({
        accountId: account.id,
        characterId: character.characterId,
        sessionId,
        fallbackSession: copilotFallbackSession,
        mode: 'feedback',
        query: requestText,
      })
      const usageStatus = await assertUsageAllowed({
        userId: req.auth?.userId,
        eventType: 'feedback_request',
        referenceId: req.body?.referenceId,
      })
      const result = await generateScriptFeedback({
        accountId: account.id,
        referenceId: req.body?.referenceId,
        selectedLabel: req.body?.selectedLabel,
        sections: req.body?.sections,
        currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
        currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
        characterSystemPrompt: character.systemPrompt,
        personalizationContext: personalization.context,
      })
      let feedbackRecord = null

      if (req.body?.scriptId) {
        feedbackRecord = await saveFeedbackRecord({
          accountId: account.id,
          scriptId: req.body.scriptId,
          scriptVersionId: req.body?.scriptVersionId ?? null,
          score: result.score,
          content: `${result.summary}\n\n${result.detail}`.trim(),
          metadata: {
            selectedLabel: req.body?.selectedLabel,
            suggestedSections: result.suggestedSections,
            referenceId: req.body?.referenceId,
            source: 'copilot_intent',
          },
        })
      }
      await recordUsageEvent({
        userId: req.auth?.userId,
        entitlementId: usageStatus.entitlement.id,
        eventType: 'feedback_request',
        referenceId: req.body?.referenceId,
      })
      const memoryUpdate = await updatePersonalizationMemory({
        accountId: account.id,
        characterId: character.characterId,
        sessionId: personalization.sessionId,
        userInput: requestText,
        assistantOutput: result.summary || result.detail || '',
        fallbackSession: copilotFallbackSession,
        mode: 'feedback',
        source: 'feedback_request',
        metadata: {
          selectedLabel: req.body?.selectedLabel || '',
          referenceId: req.body?.referenceId || '',
        },
      })

      res.json({
        type: 'feedback',
        mode: 'feedback',
        autoApplied: false,
        canUndo: false,
        intent,
        message: result.summary || `현재 초안은 ${result.score}점입니다.`,
        feedback: result,
        feedbackRecord,
        proposedSections: result.suggestedSections,
        structureDiagnosis: result.structureDiagnosis || null,
        personalization: {
          sessionId: personalization.sessionId,
          snapshot: personalization.snapshot,
          memoryUpdate,
        },
      })
      return
    }

    if (!intent.shouldModifyScript || intent.intent !== 'edit_request') {
      const personalization = await buildPersonalizationContext({
        accountId: account.id,
        characterId: character.characterId,
        sessionId,
        fallbackSession: copilotFallbackSession,
        mode: 'question',
        query: requestText,
      })
      const replyMessage = intent.reply || '어떤 부분을 도와드릴까요? 수정할 섹션과 방향을 알려주세요.'
      const memoryUpdate = await updatePersonalizationMemory({
        accountId: account.id,
        characterId: character.characterId,
        sessionId: personalization.sessionId,
        userInput: requestText,
        assistantOutput: replyMessage,
        fallbackSession: copilotFallbackSession,
        mode: 'question',
        source: 'question',
      })
      res.json({
        type: 'reply',
        mode: 'question',
        autoApplied: false,
        canUndo: false,
        intent,
        message: replyMessage,
        proposedSections: null,
        personalization: {
          sessionId: personalization.sessionId,
          snapshot: personalization.snapshot,
          memoryUpdate,
        },
      })
      return
    }

    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: copilotFallbackSession,
      mode: 'suggestion',
      query: requestText,
    })
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })
    const result = await refineScriptWithAI({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      request: requestText,
      sections: req.body?.sections,
      editTarget: intent.editTarget || req.body?.editTarget || req.body?.edit_target || '',
      currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
      currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: requestText,
      assistantOutput: result.message || '',
      fallbackSession: copilotFallbackSession,
      mode: 'suggestion',
      source: 'copilot_suggestion',
      metadata: {
        editTarget: result.editTarget || '',
        selectedLabel: req.body?.selectedLabel || '',
        changedSections: result.changedSections || [],
        referenceId: req.body?.referenceId || '',
      },
    })
    await recordUsageEvent({
      userId: req.auth?.userId,
      entitlementId: usageStatus.entitlement.id,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })

    res.json({
      type: 'refine',
      mode: 'suggestion',
      autoApplied: false,
      canUndo: false,
      intent,
      message: result.message,
      sections: result.sections,
      proposedSections: result.sections,
      editTarget: result.editTarget,
      changedSections: result.changedSections,
      diff: {
        changedSections: result.changedSections,
        reason: result.message,
      },
      flowValidation: result.flowValidation,
      personalization: {
        sessionId: personalization.sessionId,
        snapshot: personalization.snapshot,
        memoryUpdate,
      },
    })
  }),
)

app.post(
  '/api/scripts/refine',
  refineRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `refine:${account.id}:${req.body?.referenceId || 'general'}`
    const requestText = readString(req.body?.request, {
      field: 'request',
      required: true,
      maxLength: 3000,
    })
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: `refine:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'suggestion',
      query: requestText,
    })
    const result = await refineScriptWithAI({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      request: requestText,
      sections: req.body?.sections,
      editTarget: req.body?.editTarget || req.body?.edit_target || '',
      currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
      currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: requestText,
      assistantOutput: result.message || '',
      fallbackSession: `refine:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'suggestion',
      source: 'copilot_suggestion',
      metadata: {
        editTarget: result.editTarget || '',
        selectedLabel: req.body?.selectedLabel || '',
        changedSections: result.changedSections || [],
        referenceId: req.body?.referenceId || '',
      },
    })
    await recordUsageEvent({
      userId: req.auth?.userId,
      entitlementId: usageStatus.entitlement.id,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })

    res.json({
      mode: 'suggestion',
      autoApplied: false,
      canUndo: false,
      message: result.message,
      sections: result.sections,
      proposedSections: result.sections,
      editTarget: result.editTarget,
      changedSections: result.changedSections,
      diff: {
        changedSections: result.changedSections,
        reason: result.message,
      },
      flowValidation: result.flowValidation,
      personalization: {
        sessionId: personalization.sessionId,
        snapshot: personalization.snapshot,
        memoryUpdate,
      },
    })
  }),
)

app.post(
  '/api/scripts/feedback',
  feedbackRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'feedback_request',
      referenceId: req.body?.referenceId,
    })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `feedback:${account.id}:${req.body?.referenceId || 'general'}`
    const feedbackRequestText = readString(req.body?.request || '피드백 받기', {
      field: 'request',
      required: false,
      maxLength: 3000,
      fallback: '피드백 받기',
    })
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: `feedback:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'feedback',
      query: feedbackRequestText,
    })
    const result = await generateScriptFeedback({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      sections: req.body?.sections,
      currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
      currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    let feedbackRecord = null

    if (req.body?.scriptId) {
      feedbackRecord = await saveFeedbackRecord({
        accountId: account.id,
        scriptId: req.body.scriptId,
        scriptVersionId: req.body?.scriptVersionId ?? null,
        score: result.score,
        content: `${result.summary}\n\n${result.detail}`.trim(),
        metadata: {
          selectedLabel: req.body?.selectedLabel,
          suggestedSections: result.suggestedSections,
          referenceId: req.body?.referenceId,
        },
      })
    }
    await recordUsageEvent({
      userId: req.auth?.userId,
      entitlementId: usageStatus.entitlement.id,
      eventType: 'feedback_request',
      referenceId: req.body?.referenceId,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: feedbackRequestText,
      assistantOutput: result.summary || result.detail || '',
      fallbackSession: `feedback:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'feedback',
      source: 'feedback_request',
      metadata: {
        selectedLabel: req.body?.selectedLabel || '',
        referenceId: req.body?.referenceId || '',
      },
    })

    res.json({
      mode: 'feedback',
      autoApplied: false,
      canUndo: false,
      feedback: result,
      feedbackRecord,
      proposedSections: result.suggestedSections,
      structureDiagnosis: result.structureDiagnosis || null,
      personalization: {
        sessionId: personalization.sessionId,
        snapshot: personalization.snapshot,
        memoryUpdate,
      },
    })
  }),
)

if (!isProduction || enableTestRoutes) {
  app.get(
    '/api/test/error',
    asyncHandler(async (_req, _res) => {
      throw new AppError('Manual backend error for Sentry test', {
        code: 'MANUAL_TEST_ERROR',
        statusCode: 500,
        details: {
          feature: 'backend',
          purpose: 'sentry-smoke-test',
        },
      })
    }),
  )

  app.post(
    '/api/test/ai/:type',
    asyncHandler(async (req, res) => {
      const { type } = req.params
      const { input, prompt } = req.body ?? {}

      const errorByType = {
        gpt: new Error('GPT upstream request failed'),
        whisper: new Error('Whisper transcription failed'),
        db: new Error('Supabase insert failed'),
        analysis: new Error('Model output shape is invalid'),
      }

      const error = errorByType[type]

      if (!error) {
        throw new AppError('Unsupported AI error type', {
          code: 'UNSUPPORTED_AI_ERROR_TYPE',
          statusCode: 400,
          details: { supported: Object.keys(errorByType) },
        })
      }

      logAIError(type, error, {
        route: req.originalUrl,
        method: req.method,
        inputPreview: typeof input === 'string' ? input.slice(0, 200) : input,
        promptPreview: typeof prompt === 'string' ? prompt.slice(0, 200) : prompt,
      })

      throw new AppError(`${type} test failure triggered`, {
        code: 'AI_TEST_FAILURE',
        statusCode: 502,
        details: { type },
        cause: error,
      })
    }),
  )
}

app.use(notFoundHandler)
app.use(captureExceptionWithRequest)
app.use(errorHandler)

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`)
})
