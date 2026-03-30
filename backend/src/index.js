import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hasSupabaseAdminConfig } from './lib/supabase.js'
import { AppError, asyncHandler, errorHandler, notFoundHandler } from './lib/errors.js'
import {
  attachSentryRequestContext,
  captureExceptionWithRequest,
  initBackendSentry,
} from './lib/sentry.js'
import { logAIError } from './lib/ai-error-logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '../../.env') })

const app = express()
const port = Number(process.env.PORT || 3001)
const host = process.env.HOST || '0.0.0.0'
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

initBackendSentry()

app.use(
  cors({
    origin: clientOrigin,
  }),
)
app.use(express.json())
app.use(attachSentryRequestContext)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'Express API is running',
    supabaseAdminConfigured: hasSupabaseAdminConfig,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  })
})

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

app.use(notFoundHandler)
app.use(captureExceptionWithRequest)
app.use(errorHandler)

app.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`)
})
