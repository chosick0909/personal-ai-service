function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0
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

  console.info(
    '[ai-usage]',
    JSON.stringify({
      operation,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens,
      ...context,
    }),
  )

  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens,
  }
}
