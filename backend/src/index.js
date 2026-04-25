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
import { generateScriptFeedback, refineScriptWithAI } from './lib/script-assistant.js'
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
  assertUsageAllowed,
  getUserEntitlementStatus,
  recordUsageEvent,
} from './lib/entitlements.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Deploy trigger: backend touchpoint.
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

function createRateLimiter({ windowMs, max, keyPrefix = 'global' }) {
  const counters = new Map()

  return async function rateLimiter(req, _res, next) {
    const now = Date.now()
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown')
      .split(',')[0]
      .trim()
    const key = `${keyPrefix}:${ip}`

    const redisClient = await getRedisRateLimitClient()
    if (redisClient) {
      try {
        const count = await redisClient.incr(key)
        if (count === 1) {
          await redisClient.pExpire(key, windowMs)
        }
        if (count > max) {
          const ttlMs = await redisClient.pTTL(key)
          next(
            new AppError('Too many requests. Please try again later.', {
              code: 'RATE_LIMITED',
              statusCode: 429,
              details: {
                retryAfterMs: ttlMs > 0 ? ttlMs : windowMs,
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
      next(
        new AppError('Too many requests. Please try again later.', {
          code: 'RATE_LIMITED',
          statusCode: 429,
          details: {
            retryAfterMs: Math.max(current.resetAt - now, 0),
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
const analyzeRateLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 8, keyPrefix: 'analyze' })
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
    await validateUploadedFile(req.file, {
      fieldName: 'video',
      allowedMimePrefixes: ['video/'],
      allowedExtensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'],
      magicType: 'video',
    })
    try {
      const account = await resolveRequestAccount(req)
      const usageStatus = await assertUsageAllowed({
        userId: req.auth?.userId,
        eventType: 'reference_analysis',
      })
      const character = await getAccountCharacterContext(account.id)
      const result = await analyzeReferenceVideo({
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
      })
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
    const character = await getAccountCharacterContext(account.id)
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `ask:${account.id}`
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      sessionId,
      fallbackSession: `ask:${account.id}`,
    })
    const query = readString(req.body?.query, {
      field: 'query',
      required: true,
      maxLength: 2000,
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
      sessionId: personalization.sessionId,
      userInput: query,
      assistantOutput: result.answer,
      fallbackSession: `ask:${account.id}`,
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
  '/api/scripts/refine',
  refineRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })
    const character = await getAccountCharacterContext(account.id)
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `refine:${req.body?.referenceId || account.id}`
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      sessionId,
      fallbackSession: `refine:${req.body?.referenceId || account.id}`,
    })
    const requestText = readString(req.body?.request, {
      field: 'request',
      required: true,
      maxLength: 3000,
    })
    const result = await refineScriptWithAI({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      request: requestText,
      sections: req.body?.sections,
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    const assistantOutputSummary = [
      result.message,
      result.sections?.hook ? `HOOK: ${result.sections.hook}` : '',
      result.sections?.body ? `BODY: ${result.sections.body}` : '',
      result.sections?.cta ? `CTA: ${result.sections.cta}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      sessionId: personalization.sessionId,
      userInput: requestText,
      assistantOutput: assistantOutputSummary,
      fallbackSession: `refine:${req.body?.referenceId || account.id}`,
    })
    await recordUsageEvent({
      userId: req.auth?.userId,
      entitlementId: usageStatus.entitlement.id,
      eventType: 'copilot_message',
      referenceId: req.body?.referenceId,
    })

    res.json({
      message: result.message,
      sections: result.sections,
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
    const character = await getAccountCharacterContext(account.id)
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `feedback:${req.body?.referenceId || account.id}`
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      sessionId,
      fallbackSession: `feedback:${req.body?.referenceId || account.id}`,
    })
    const result = await generateScriptFeedback({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      sections: req.body?.sections,
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

    res.json({
      feedback: result,
      feedbackRecord,
      personalization: {
        sessionId: personalization.sessionId,
        snapshot: personalization.snapshot,
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
