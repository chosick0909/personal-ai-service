// Keep UTF-16 limits without splitting a Unicode surrogate pair.
export function truncateUnicode(text, limit) {
  const value = String(text ?? '')
  let end = Math.max(0, Math.floor(limit))
  if (end >= value.length) return value
  const before = value.charCodeAt(end - 1)
  const after = value.charCodeAt(end)
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end--
  return value.slice(0, end)
}

export function normalizeJSONUnicode(body) {
  const parsed = JSON.parse(body)
  let repairedStrings = 0
  const normalize = value => {
    if (typeof value === 'string') {
      if (value.isWellFormed()) return value
      repairedStrings++
      return value.toWellFormed()
    }
    if (Array.isArray(value)) return value.map(normalize)
    if (value && typeof value === 'object') {
      const entries = Object.entries(value).map(([key, item]) => [normalize(key), normalize(item)])
      if (new Set(entries.map(([key]) => key)).size !== entries.length) {
        throw new Error('Unicode normalization would duplicate a JSON property')
      }
      return Object.fromEntries(entries)
    }
    return value
  }
  const normalized = normalize(parsed)
  return { body: repairedStrings ? JSON.stringify(normalized) : body, repairedStrings }
}

// The SDK serializes JSON before fetch. JSON.stringify accepts lone surrogates,
// while a provider's Unicode JSON decoder can reject them before generation.
// Multipart audio/files and streaming bodies must pass through unchanged.
export function createOpenAITransport(fetchImpl = globalThis.fetch, diagnostic = (data) => {
  console.warn('[openai-request-contract]', data)
}) {
  return async (url, init) => {
    let normalized
    const headers = new Headers(init?.headers)
    if (typeof init?.body === 'string' && headers.get('content-type')?.includes('application/json')) {
      normalized = normalizeJSONUnicode(init.body)
      if (normalized.repairedStrings) {
        init = { ...init, body: normalized.body }
        // Let fetch recompute the encoded byte length.
        headers.delete('content-length')
        init.headers = headers
        diagnostic({ event: 'unicode_repaired', repairedStrings: normalized.repairedStrings })
      }
    }
    const response = await fetchImpl(url, init)
    if (response.status === 400 && normalized) {
      const error = await response.clone().json().catch(() => null)
      if (error?.error?.code === 'invalid_json') diagnostic({
        event: 'provider_invalid_json',
        requestId: response.headers.get('x-request-id'),
        bodyBytes: Buffer.byteLength(normalized.body, 'utf8'),
        jsonParseValid: true,
        repairedStrings: normalized.repairedStrings,
      })
    }
    return response
  }
}
