export function parseModelJson(rawText) {
  const trimmed = rawText?.trim()

  if (!trimmed) {
    throw new Error('Model returned empty content')
  }

  try {
    return JSON.parse(trimmed)
  } catch {}

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Model did not return JSON')
  }

  return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1))
}
