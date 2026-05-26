import { recordAIUsageLogSafe } from './analytics-logger.js'

const DEFAULT_MODEL_PRICES_PER_1M = {
  'gpt-5.2': { input: 1.25, output: 10 },
  'gpt-5.1': { input: 1.25, output: 10 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-mini-transcribe': { input: 0.15, output: 0.6 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0
}

function normalizeModel(model) {
  return String(model || '').trim()
}

function parsePriceOverrides() {
  const raw = process.env.OPENAI_MODEL_PRICES_JSON
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    console.warn('[ai-usage-price-override-invalid]', {
      message: error?.message || String(error),
    })
    return {}
  }
}

export function getModelPricePer1M(model) {
  const normalized = normalizeModel(model)
  if (!normalized) return null

  const overrides = parsePriceOverrides()
  const price = overrides[normalized] || DEFAULT_MODEL_PRICES_PER_1M[normalized]

  if (!price || !Number.isFinite(Number(price.input)) || !Number.isFinite(Number(price.output))) {
    return null
  }

  return {
    input: Number(price.input),
    output: Number(price.output),
  }
}

export function estimateAIUsageCostUsd({ model, promptTokens = 0, completionTokens = 0 } = {}) {
  const price = getModelPricePer1M(model)
  if (!price) return null

  const estimated =
    (Math.max(0, promptTokens) / 1_000_000) * price.input +
    (Math.max(0, completionTokens) / 1_000_000) * price.output

  return Number(estimated.toFixed(8))
}

export function extractAIUsage(responseOrUsage = {}) {
  const usage = responseOrUsage?.usage || responseOrUsage || {}

  return {
    promptTokens: numberOrZero(usage.prompt_tokens ?? usage.input_tokens),
    completionTokens: numberOrZero(usage.completion_tokens ?? usage.output_tokens),
    totalTokens: numberOrZero(usage.total_tokens),
  }
}

export function sumAIUsage(...items) {
  return items
    .map((item) => extractAIUsage(item))
    .reduce(
      (acc, usage) => ({
        promptTokens: acc.promptTokens + usage.promptTokens,
        completionTokens: acc.completionTokens + usage.completionTokens,
        totalTokens:
          acc.totalTokens +
          (usage.totalTokens || usage.promptTokens + usage.completionTokens),
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    )
}

export function logAIUsage(operation, responseOrUsage, context = {}) {
  const usage = extractAIUsage(responseOrUsage)
  const totalTokens = usage.totalTokens || usage.promptTokens + usage.completionTokens
  const model = context.model || responseOrUsage?.model || ''
  const estimatedCostUsd = estimateAIUsageCostUsd({
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  })

  console.info(
    '[ai-usage]',
    JSON.stringify({
      operation,
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens,
      estimatedCostUsd,
      ...context,
    }),
  )

  recordAIUsageLogSafe({
    operation,
    model,
    accountId: context.accountId,
    userId: context.userId,
    referenceId: context.referenceId,
    sessionId: context.sessionId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens,
    estimatedCostUsd,
    latencyMs: context.latencyMs ?? context.latency_ms,
    metadata: context.metadata || {},
  })

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens,
    estimatedCostUsd,
  }
}
