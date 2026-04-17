import * as Sentry from '@sentry/node'

const typeMetadata = {
  gpt: { feature: 'gpt', operation: 'completion' },
  embedding: { feature: 'embedding', operation: 'vectorize' },
  vision: { feature: 'vision', operation: 'frame-analysis' },
  whisper: { feature: 'whisper', operation: 'transcription' },
  db: { feature: 'db', operation: 'save' },
  analysis: { feature: 'analysis', operation: 'post-processing' },
}

function truncateValue(value) {
  if (typeof value === 'string') {
    return value.slice(0, 500)
  }

  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value).slice(0, 500)
  }

  return value
}

function sanitizeContext(context = {}) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, truncateValue(value)]),
  )
}

export function logAIError(type, error, context = {}) {
  const metadata = typeMetadata[type] || {
    feature: type || 'unknown',
    operation: 'unknown',
  }
  const safeContext = sanitizeContext(context)

  Sentry.withScope((scope) => {
    scope.setTag('domain', 'ai-service')
    scope.setTag('feature', metadata.feature)
    scope.setTag('operation', metadata.operation)
    scope.setContext('ai_context', safeContext)
    // Avoid attaching raw input/prompt text to error telemetry.
    // Keep only coarse metadata to reduce privacy leakage risk.
    scope.setExtra('input_length', String(safeContext.inputPreview || '').length || null)
    scope.setExtra('prompt_length', String(safeContext.promptPreview || '').length || null)

    Sentry.captureException(error)
  })
}
