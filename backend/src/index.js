import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
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
import {
  classifyCopilotIntent,
  buildEditPlan,
  createSectionDiff,
  generateScriptFeedback,
  refineScriptWithAI,
  repairRefinedScriptWithQaIssues,
  runFeedbackFallbackRuleCheck,
  sanitizeUserFacingCopilotMessage,
  shouldUseHeavyQualityGateForCopilot,
  normalizeTargetDurationSeconds,
  validateScriptFlow,
  validateRefinedScriptQuality,
} from './lib/script-assistant.js'
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
  createReferenceUploadSession,
  deleteReferenceVideo,
  getReferenceUploadSessionByClientUploadId,
  getReferenceVideo,
  listReferenceVideos,
  updateReferenceUploadSessionState,
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
  createClientOrigins,
  createRateLimiter,
  createSecurityHeaders,
  getClientIp,
  getDefaultRateLimitIdentity,
  normalizeOrigin,
} from './lib/http-middleware.js'
import {
  readNumber,
  readRequestCharacterId,
  readString,
  readTextList,
} from './lib/request-readers.js'
import { removeUploadedTempFile, validateUploadedFile } from './lib/upload-validation.js'
import {
  applyCouponToUser,
  assertEntitlementAccess,
  assertUsageAllowed,
  getUserEntitlementStatus,
  recordUsageEvent,
} from './lib/entitlements.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })
assertBackendEnv()

const app = express()
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:8080'
function estimateSectionsSeconds(sections = {}) {
  const text = [sections?.hook, sections?.body, sections?.cta].join(' ')
  const count = String(text || '').replace(/\s+/g, '').length
  if (!count) {
    return 0
  }
  return Math.max(1, Math.round(count / 5))
}

const defaultAllowedOrigins = [
  'http://localhost:8080',
  'http://localhost:4173',
  'https://www.hookai.kr',
  'https://hookai.kr',
]
const clientOrigins = createClientOrigins({
  clientOrigin,
  clientOrigins: process.env.CLIENT_ORIGINS,
  defaultAllowedOrigins,
})
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
const securityHeaders = createSecurityHeaders({ isProduction })

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

function compactFeedbackList(value = []) {
  if (!Array.isArray(value)) {
    return ''
  }
  return value
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((item) => `- ${item}`)
    .join('\n')
}

function buildFeedbackApplyRequest(feedback = {}, editTarget = 'all') {
  const summary = String(feedback?.summary || '').trim()
  const detail = String(feedback?.detail || '').trim()
  const structureDiagnosis = feedback?.structureDiagnosis
    ? JSON.stringify(feedback.structureDiagnosis).slice(0, 2500)
    : ''
  const issues = compactFeedbackList(feedback?.issues)
  const recommendations = compactFeedbackList(feedback?.recommendations)
  const normalizedEditTarget = String(editTarget || '').trim() || 'all'

  return [
    '아래 피드백 진단을 실제 대본 수정에 반영해줘.',
    '피드백의 말과 수정본이 따로 놀면 안 된다.',
    '단순히 문장을 예쁘게 다듬는 게 아니라, 피드백에서 지적한 문제를 실제로 해결해야 한다.',
    'HOOK 문제면 HOOK을, BODY 문제면 BODY를, CTA 문제면 CTA를 고친다.',
    '피드백에서 지적한 문제가 있는데 현재 문장을 그대로 반환하면 실패다. 최소한 문제가 지적된 섹션은 실제로 달라져야 한다.',
    normalizedEditTarget !== 'all'
      ? `수정 범위는 ${normalizedEditTarget}로 제한한다. 요청받지 않은 섹션은 원문 그대로 유지한다.`
      : '수정 범위는 전체이지만, 문제가 없는 섹션은 억지로 바꾸지 않는다.',
    '',
    '[피드백 요약]',
    summary || '-',
    '',
    '[피드백 상세]',
    detail || '-',
    issues ? ['', '[지적된 문제]', issues].join('\n') : '',
    recommendations ? ['', '[추천 수정 방향]', recommendations].join('\n') : '',
    structureDiagnosis ? ['', '[구조 진단]', structureDiagnosis].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n')
}

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

app.post(
  '/api/reference-videos/upload-session',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const clientUploadId =
      req.body?.clientUploadId ||
      req.body?.client_upload_id ||
      req.headers['x-idempotency-key'] ||
      ''
    const session = await createReferenceUploadSession({
      accountId: account.id,
      projectId: req.body?.projectId || null,
      title: req.body?.title,
      topic: req.body?.topic,
      originalFilename: req.body?.originalFilename || req.body?.fileName || '',
      mimeType: req.body?.mimeType || '',
      clientUploadId,
    })

    logReferenceUploadStage(req, 'upload_session_created', {
      accountId: account.id,
      status: 'success',
      referenceId: session?.id || null,
    })

    res.status(201).json({
      message: 'Reference upload session created',
      analysis: session,
      referenceId: session?.id || null,
    })
  }),
)

app.get(
  '/api/reference-videos/upload-session/:clientUploadId',
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req, { body: false })
    const session = await getReferenceUploadSessionByClientUploadId({
      accountId: account.id,
      clientUploadId: req.params.clientUploadId,
    })

    if (!session) {
      res.status(404).json({
        error: {
          code: 'UPLOAD_SESSION_NOT_FOUND',
          message: 'Upload session not found',
        },
      })
      return
    }

    res.json({
      analysis: session,
      referenceId: session?.id || null,
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
    let account = null
    const referenceId = String(req.body?.referenceId || req.body?.reference_id || '').trim()
    try {
      account = await resolveRequestAccount(req)
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
      if (referenceId && account?.id) {
        await updateReferenceUploadSessionState({
          accountId: account.id,
          referenceId,
          patch: {
            processing_status: 'failed',
            current_stage: 'file_validation',
            failure_stage: 'file_validation',
            failure_code: error.code || 'FILE_VALIDATION_FAILED',
            failure_message: error.message || '업로드한 파일을 확인하지 못했습니다.',
          },
        })
      }
      await removeUploadedTempFile(req.file)
      throw error
    }
    if (referenceId) {
      await updateReferenceUploadSessionState({
        accountId: account.id,
        referenceId,
        patch: {
          current_stage: 'upload_received',
        },
      })
      logReferenceUploadStage(req, 'upload_received', {
        accountId: account.id,
        status: 'success',
        referenceId,
      })
    }
    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'reference_analysis',
    })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const analysisInput = {
      accountId: account.id,
      referenceId,
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

app.post(
  '/api/reference-videos/analyze-text',
  analyzeRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const scriptText = String(req.body?.scriptText || req.body?.transcript || '').trim()

    if (scriptText.length < 20) {
      throw new AppError('레퍼런스 대본은 최소 20자 이상 입력해주세요.', {
        code: 'REFERENCE_SCRIPT_TOO_SHORT',
        statusCode: 400,
      })
    }

    if (scriptText.length > 20000) {
      throw new AppError('레퍼런스 대본이 너무 깁니다. 2만 자 이하로 줄여주세요.', {
        code: 'REFERENCE_SCRIPT_TOO_LONG',
        statusCode: 400,
      })
    }

    const usageStatus = await assertUsageAllowed({
      userId: req.auth?.userId,
      eventType: 'reference_analysis',
    })
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    let accepted = false
    let resolveAccepted
    let rejectAccepted
    const acceptedPromise = new Promise((resolve, reject) => {
      resolveAccepted = resolve
      rejectAccepted = reject
    })

    const analysisPromise = analyzeReferenceVideo({
      accountId: account.id,
      scriptText,
      topic: req.body?.topic,
      title: req.body?.title || '대본 레퍼런스',
      projectId: req.body?.projectId || null,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || '',
      characterSystemPrompt: character.systemPrompt,
      accountSettings:
        character?.profile?.settings && typeof character.profile.settings === 'object'
          ? character.profile.settings
          : {},
      onAnalysisPreviewReady: async (previewReference) => {
        if (accepted) {
          return
        }
        accepted = true
        resolveAccepted(previewReference)
      },
    })

    analysisPromise
      .then(async (result) => {
        if (!accepted) {
          accepted = true
          resolveAccepted(result)
        }
        await recordUsageEvent({
          userId: req.auth?.userId,
          entitlementId: usageStatus.entitlement.id,
          eventType: 'reference_analysis',
          referenceId: result?.id || null,
        })
      })
      .catch((error) => {
        if (!accepted) {
          accepted = true
          rejectAccepted(error)
        }
        logAIError('analysis', error, {
          stage: 'async-reference-script-analysis',
          accountId: account.id,
        })
      })

    const previewReference = await acceptedPromise
    res.status(202).json({
      message: 'Reference script analysis accepted',
      analysis: previewReference,
    })
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
    const targetDurationRaw = req.body?.targetDurationSeconds ?? req.body?.target_duration_seconds
    const targetDurationSeconds = normalizeTargetDurationSeconds(targetDurationRaw)
    if (targetDurationRaw !== undefined && targetDurationRaw !== null && !targetDurationSeconds) {
      throw new AppError('목표 시간은 10초 이상으로 입력해주세요.', {
        code: 'INVALID_DURATION_TARGET',
        statusCode: 400,
      })
    }
    if (targetDurationSeconds) {
      const currentEstimatedSeconds = estimateSectionsSeconds(req.body?.sections)
      if (currentEstimatedSeconds > 0 && targetDurationSeconds >= currentEstimatedSeconds) {
        throw new AppError('현재 대본보다 짧은 시간만 입력할 수 있어요.', {
          code: 'INVALID_DURATION_TARGET',
          statusCode: 400,
        })
      }
    }
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
      targetDurationSeconds,
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

    if (intent.intent === 'advise_script' && req.body?.referenceId) {
      const personalization = await buildPersonalizationContext({
        accountId: account.id,
        characterId: character.characterId,
        sessionId,
        fallbackSession: copilotFallbackSession,
        mode: 'question',
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
      editTarget: 'none',
      currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
      currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
      copilotMemory: req.body?.copilotMemory || req.body?.copilot_memory || {},
    })
      const memoryUpdate = await updatePersonalizationMemory({
        accountId: account.id,
        characterId: character.characterId,
        sessionId: personalization.sessionId,
        userInput: requestText,
        assistantOutput: result.message || '',
        fallbackSession: copilotFallbackSession,
        mode: 'question',
        source: 'copilot_advice',
        metadata: {
          selectedLabel: req.body?.selectedLabel || '',
          referenceId: req.body?.referenceId || '',
          copilotIntent: result.copilotIntent || intent.intent,
        },
      })
      await recordUsageEvent({
        userId: req.auth?.userId,
        entitlementId: usageStatus.entitlement.id,
        eventType: 'copilot_message',
        referenceId: req.body?.referenceId,
      })
      res.json({
        type: 'reply',
        mode: 'advice',
        autoApplied: false,
        canUndo: false,
        intent: {
          ...intent,
          copilotIntent: result.copilotIntent,
          responseMode: result.responseMode,
        },
        message: result.message,
        sections: result.sections,
        changedSections: [],
        flowValidation: result.flowValidation,
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
    const copilotMemory = req.body?.copilotMemory || req.body?.copilot_memory || {}
    const editPlan = buildEditPlan({
      userRequest: requestText,
      currentSections: req.body?.sections,
      intentResult: intent,
      editTarget: intent.editTarget || req.body?.editTarget || req.body?.edit_target || '',
      copilotMemory,
      targetDurationSeconds,
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
      copilotMemory,
      editPlan,
    })
    const qualityStartedAt = Date.now()
    const qaFeedback = {
      summary: `일반 코파일럿 수정 요청: ${requestText}`,
      detail: `내부 편집 계획: ${editPlan.strategy}`,
      issues: [],
      recommendations: [
        ...(editPlan.change || []),
        ...(editPlan.avoid || []).map((item) => `피해야 할 요소: ${item}`),
      ],
    }
    const useHeavyQualityGate = shouldUseHeavyQualityGateForCopilot({
      request: requestText,
      editTarget: result.editTarget || editPlan.editTarget,
      targetSections: editPlan.targetSections,
      operationType: editPlan.operationType,
    })
    let finalSections = result.sections
    let finalMessage = result.message
    let finalChangedSections = result.changedSections || []
    let finalFlowValidation = result.flowValidation
    let qualityGate = {
      passed: true,
      repaired: false,
      issueTypes: [],
      fallbackUsed: false,
      fallbackType: 'none',
    }
    let repairAttempted = false
    let repairSuccess = false

    if (useHeavyQualityGate) {
      const qaResult = await validateRefinedScriptQuality({
        accountId: account.id,
        referenceId: req.body?.referenceId,
        selectedLabel: req.body?.selectedLabel,
        originalSections: req.body?.sections,
        proposedSections: result.sections,
        request: requestText,
        editTarget: result.editTarget || editPlan.editTarget,
        feedback: qaFeedback,
        characterSystemPrompt: character.systemPrompt,
        personalizationContext: personalization.context,
        qaMode: editPlan.qaMode,
        newSubject: editPlan.newSubject,
        requestedMaterials: editPlan.requestedMaterials,
        targetSections: editPlan.targetSections,
        preserveSections: editPlan.preserveSections,
        targetDurationSeconds: editPlan.targetDurationSeconds,
        targetCharRange: editPlan.targetCharRange,
      })
      qualityGate = {
        passed: qaResult.ok,
        repaired: false,
        issueTypes: qaResult.issueTypes || [],
        fallbackUsed: false,
        fallbackType: 'none',
      }

      if (qaResult.shouldRepair) {
        repairAttempted = true
        const repairResult = await repairRefinedScriptWithQaIssues({
          accountId: account.id,
          referenceId: req.body?.referenceId,
          selectedLabel: req.body?.selectedLabel,
          originalSections: req.body?.sections,
          proposedSections: result.sections,
          request: requestText,
          editTarget: result.editTarget || editPlan.editTarget,
          feedback: qaFeedback,
          qaIssues: qaResult.issues,
          characterSystemPrompt: character.systemPrompt,
          personalizationContext: personalization.context,
          qaMode: editPlan.qaMode,
          newSubject: editPlan.newSubject,
          requestedMaterials: editPlan.requestedMaterials,
          targetSections: editPlan.targetSections,
          preserveSections: editPlan.preserveSections,
          targetDurationSeconds: editPlan.targetDurationSeconds,
          targetCharRange: editPlan.targetCharRange,
        })

        if (repairResult.success) {
          repairSuccess = true
          finalSections = repairResult.sections
          finalMessage = repairResult.message || finalMessage
          qualityGate = {
            ...qualityGate,
            repaired: true,
          }
        } else {
          finalSections = req.body?.sections || result.sections
          finalMessage =
            '요청하신 내용을 반영하려 했지만, 기존 대본 흐름과 충돌하는 부분이 있어 자동 적용하지 않았어요. 새 주제로 전체를 다시 만들거나, 특정 섹션에만 추가하는 방식으로 다시 요청해 주세요.'
          qualityGate = {
            ...qualityGate,
            fallbackUsed: true,
            fallbackType: 'original',
          }
        }
      }
    } else {
      const ruleCheck = runFeedbackFallbackRuleCheck({
        originalSections: req.body?.sections,
        candidateSections: result.sections,
        editTarget: result.editTarget || editPlan.editTarget,
        feedback: qaFeedback,
        request: requestText,
        qaMode: editPlan.qaMode,
        newSubject: editPlan.newSubject,
        requestedMaterials: editPlan.requestedMaterials,
        targetSections: editPlan.targetSections,
        targetDurationSeconds: editPlan.targetDurationSeconds,
        targetCharRange: editPlan.targetCharRange,
      })
      qualityGate = {
        passed: ruleCheck.ok,
        repaired: false,
        issueTypes: ruleCheck.issueTypes || [],
        fallbackUsed: false,
        fallbackType: 'none',
      }
      if (ruleCheck.shouldRepair) {
        finalSections = req.body?.sections || result.sections
        finalMessage =
          '요청하신 내용을 반영하려 했지만, 기존 대본 흐름과 충돌하는 부분이 있어 자동 적용하지 않았어요. 새 주제로 전체를 다시 만들거나, 특정 섹션에만 추가하는 방식으로 다시 요청해 주세요.'
        qualityGate = {
          ...qualityGate,
          fallbackUsed: true,
          fallbackType: 'original',
        }
      }
    }

    const finalDiff = createSectionDiff(req.body?.sections, finalSections)
    finalChangedSections = ['hook', 'body', 'cta'].filter((key) => finalDiff[key])
    finalFlowValidation = validateScriptFlow(finalSections)
    finalMessage = sanitizeUserFacingCopilotMessage(finalMessage, {
      editPlan,
      responseMode: result.responseMode,
      changedSections: finalChangedSections,
    })
    console.info('[copilot-quality-gate]', {
      account_id: account.id,
      character_id: character.characterId,
      reference_id: req.body?.referenceId || '',
      script_version_id: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      intent: intent.intent,
      edit_target: result.editTarget || editPlan.editTarget || '',
      edit_plan_strategy: editPlan.strategy,
      operation_type: editPlan.operationType,
      qa_mode: editPlan.qaMode,
      qa_passed: qualityGate.passed,
      qa_failed_issue_types: qualityGate.issueTypes || [],
      repair_attempted: repairAttempted,
      repair_success: repairSuccess,
      session_memory_used: Boolean(Object.values(copilotMemory || {}).some((value) => Array.isArray(value) ? value.length : value)),
      latency_ms: Date.now() - qualityStartedAt,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: requestText,
      assistantOutput: finalMessage || '',
      fallbackSession: copilotFallbackSession,
      mode: 'suggestion',
      source: 'copilot_suggestion',
      metadata: {
        editTarget: result.editTarget || editPlan.editTarget || '',
        selectedLabel: req.body?.selectedLabel || '',
        changedSections: finalChangedSections || [],
        referenceId: req.body?.referenceId || '',
        editPlan,
        qualityGate,
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
      copilotIntent: result.copilotIntent,
      responseMode: result.responseMode,
      message: finalMessage,
      sections: finalSections,
      proposedSections: finalSections,
      editTarget: result.editTarget || editPlan.editTarget,
      changedSections: finalChangedSections,
      diff: {
        changedSections: finalChangedSections,
        reason: finalMessage,
      },
      flowValidation: finalFlowValidation,
      qualityGate,
      editPlan,
      sessionMemoryUsed: Boolean(Object.values(copilotMemory || {}).some((value) => Array.isArray(value) ? value.length : value)),
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
      copilotMemory: req.body?.copilotMemory || req.body?.copilot_memory || {},
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
      mode: result.editTarget === 'none' ? 'advice' : 'suggestion',
      autoApplied: false,
      canUndo: false,
      message: result.message,
      sections: result.sections,
      proposedSections: result.editTarget === 'none' ? null : result.sections,
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

app.post(
  '/api/scripts/feedback/apply',
  refineRateLimiter,
  asyncHandler(async (req, res) => {
    const account = await resolveRequestAccount(req)
    const character = await getAccountCharacterContext(account.id, { characterId: readRequestCharacterId(req) })
    const feedback = req.body?.feedback && typeof req.body.feedback === 'object' ? req.body.feedback : {}
    const editTarget = req.body?.editTarget || req.body?.edit_target || 'all'
    const requestText = buildFeedbackApplyRequest(feedback, editTarget)
    const sessionId =
      req.body?.sessionId ||
      req.body?.session_id ||
      req.headers['x-session-id'] ||
      `feedback-apply:${account.id}:${req.body?.referenceId || 'general'}`
    const personalization = await buildPersonalizationContext({
      accountId: account.id,
      characterId: character.characterId,
      sessionId,
      fallbackSession: `feedback-apply:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'suggestion',
      query: requestText,
    })
    const result = await refineScriptWithAI({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      request: requestText,
      sections: req.body?.sections,
      editTarget,
      currentDraftId: req.body?.currentDraftId || req.body?.scriptId || '',
      currentVersionId: req.body?.currentVersionId || req.body?.scriptVersionId || '',
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
      copilotMemory: req.body?.copilotMemory || req.body?.copilot_memory || {},
    })
    const qaStartedAt = Date.now()
    const qaResult = await validateRefinedScriptQuality({
      accountId: account.id,
      referenceId: req.body?.referenceId,
      selectedLabel: req.body?.selectedLabel,
      originalSections: req.body?.sections,
      proposedSections: result.sections,
      request: requestText,
      editTarget: result.editTarget || editTarget,
      feedback,
      characterSystemPrompt: character.systemPrompt,
      personalizationContext: personalization.context,
    })
    let finalSections = result.sections
    let finalMessage = result.message
    let qualityGate = {
      passed: qaResult.ok,
      repaired: false,
      issueTypes: qaResult.issueTypes || [],
      fallbackUsed: false,
      fallbackType: 'none',
    }
    let repairAttempted = false
    let repairSuccess = false

    if (qaResult.shouldRepair) {
      repairAttempted = true
      const repairResult = await repairRefinedScriptWithQaIssues({
        accountId: account.id,
        referenceId: req.body?.referenceId,
        selectedLabel: req.body?.selectedLabel,
        originalSections: req.body?.sections,
        proposedSections: result.sections,
        request: requestText,
        editTarget: result.editTarget || editTarget,
        feedback,
        qaIssues: qaResult.issues,
        characterSystemPrompt: character.systemPrompt,
        personalizationContext: personalization.context,
      })

      if (repairResult.success) {
        repairSuccess = true
        finalSections = repairResult.sections
        finalMessage = repairResult.message || finalMessage
        qualityGate = {
          ...qualityGate,
          passed: false,
          repaired: true,
        }
      } else {
        const fallbackCheck = runFeedbackFallbackRuleCheck({
          originalSections: req.body?.sections,
          candidateSections: feedback?.suggestedSections,
          editTarget: result.editTarget || editTarget,
          feedback,
          request: requestText,
        })

        if (feedback?.suggestedSections && !fallbackCheck.shouldRepair) {
          finalSections = feedback.suggestedSections
          finalMessage = '피드백에서 짚은 방향을 기준으로 적용 가능한 수정안을 반영했어요. 흐름을 크게 흔들지 않는 선에서 문장을 정리했습니다.'
          qualityGate = {
            ...qualityGate,
            repaired: false,
            fallbackUsed: true,
            fallbackType: 'suggestedSections',
          }
        } else {
          throw new AppError('Feedback apply quality gate failed', {
            code: 'FEEDBACK_APPLY_QUALITY_FAILED',
            statusCode: 502,
            details: {
              qaIssues: qaResult.issueTypes || [],
              fallbackIssues: fallbackCheck.issueTypes || [],
            },
          })
        }
      }
    }
    const finalDiff = createSectionDiff(req.body?.sections, finalSections)
    const finalChangedSections = ['hook', 'body', 'cta'].filter((key) => finalDiff[key])
    const finalFlowValidation = validateScriptFlow(finalSections)
    console.info('[feedback-apply-quality-gate]', {
      account_id: account.id,
      character_id: character.characterId,
      reference_id: req.body?.referenceId || '',
      qa_passed: qaResult.ok,
      qa_failed_issue_types: qaResult.issueTypes || [],
      repair_attempted: repairAttempted,
      repair_success: repairSuccess,
      fallback_used: qualityGate.fallbackUsed,
      fallback_type: qualityGate.fallbackType,
      edit_target: result.editTarget || editTarget || '',
      latency_ms: Date.now() - qaStartedAt,
    })
    const memoryUpdate = await updatePersonalizationMemory({
      accountId: account.id,
      characterId: character.characterId,
      sessionId: personalization.sessionId,
      userInput: requestText,
      assistantOutput: finalMessage || '',
      fallbackSession: `feedback-apply:${account.id}:${req.body?.referenceId || 'general'}`,
      mode: 'suggestion',
      source: 'feedback_apply',
      metadata: {
        editTarget: result.editTarget || editTarget || '',
        selectedLabel: req.body?.selectedLabel || '',
        changedSections: finalChangedSections,
        referenceId: req.body?.referenceId || '',
        feedbackSummary: String(feedback?.summary || '').slice(0, 300),
        qualityGate,
      },
    })

    res.json({
      hook: finalSections.hook,
      body: finalSections.body,
      cta: finalSections.cta,
      sections: finalSections,
      proposedSections: finalSections,
      message: finalMessage,
      editTarget: result.editTarget,
      changedSections: finalChangedSections,
      flowValidation: finalFlowValidation,
      qualityGate,
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
