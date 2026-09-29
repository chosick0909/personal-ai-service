// An operation override takes precedence over the writing group. No model default changes.
const writing = new Set(['reference-analysis', 'media-hook-diagnosis'])
export function operationModel(operation, fallback, env = process.env) {
  const key = `CREATOR_MODEL_${String(operation).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  return env[key]?.trim() || (writing.has(operation) && env.CREATOR_WRITING_MODEL?.trim()) || env.CREATOR_TEXT_MODEL || fallback
}
export function parseJsonCompletion(response) {
  const choice = response.choices?.[0]
  if (choice?.message?.refusal || choice?.finish_reason !== 'stop' || !choice?.message?.content?.trim()) {
    throw structuredResponseError('CREATOR_INCOMPLETE_RESPONSE')
  }
  try { return JSON.parse(choice.message.content) }
  catch { throw structuredResponseError('CREATOR_INVALID_JSON') }
}
export function structuredResponseError(code) {
  const error = new Error('AI 응답을 완성하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.')
  error.code = code
  error.statusCode = 422
  error.exposeMessage = true
  return error
}
