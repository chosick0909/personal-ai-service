// Optional quality work may fall back, but cancellation must never publish a result.
export function assertQualityActive(ctx) {
  if (!ctx.signal?.aborted) return
  const error = new Error('작업이 중단되었습니다. 저장된 단계에서 다시 시도합니다.')
  error.code = 'CREATOR_JOB_INTERRUPTED'
  error.statusCode = 503
  throw error
}

export async function optionalCheckpoint(ctx, name, generate, validate, fallback = null) {
  assertQualityActive(ctx)
  try {
    const result = await ctx.checkpoint(name, async () => {
      assertQualityActive(ctx)
      const value = await generate()
      assertQualityActive(ctx)
      // Validate before checkpoint persistence. Failed calls and invalid results
      // throw, so neither transient errors nor fallback values become checkpoints.
      validate(value)
      return value
    })
    assertQualityActive(ctx)
    validate(result)
    return result
  } catch (error) {
    assertQualityActive(ctx)
    if (error?.name === 'AbortError' || error?.code === 'CREATOR_JOB_INTERRUPTED') throw error
    return fallback
  }
}
