import { hasKoreanTranslation } from './referenceTranslation.js'
const HANDOFF_KEY = 'hookai:studio-writer-handoff'
export const STUDIO_HANDOFF_PARAM = 'studioDraft'
const HANDOFF_TTL_MS = 10 * 60 * 1000

function sessionStorageOrNull() {
  try { return window.sessionStorage } catch { return null }
}

export function stageStudioWriterHandoff({ text, userId, accountId }, {
  storage = sessionStorageOrNull(), now = Date.now(), token = globalThis.crypto?.randomUUID?.(),
} = {}) {
  if (typeof text !== 'string' || !text.trim() || !userId || !accountId || !token || !storage) return null
  try {
    const payload = JSON.stringify({ token, userId, accountId, text: text.trim(), createdAt: now })
    storage.setItem(HANDOFF_KEY, payload)
    if (storage.getItem(HANDOFF_KEY) !== payload) return null
    return `/analyze?${STUDIO_HANDOFF_PARAM}=${encodeURIComponent(token)}#upload`
  } catch { return null }
}

export function consumeStudioWriterHandoff({ token, userId, accountId }, {
  storage = sessionStorageOrNull(), now = Date.now(),
} = {}) {
  if (!token || !userId || !accountId || !storage) return null
  try {
    const value = JSON.parse(storage.getItem(HANDOFF_KEY) || 'null')
    if (!value || value.token !== token) return null
    if (!Number.isFinite(value.createdAt) || now - value.createdAt < 0 || now - value.createdAt > HANDOFF_TTL_MS) {
      storage.removeItem(HANDOFF_KEY)
      return null
    }
    if (value.userId !== userId || value.accountId !== accountId || typeof value.text !== 'string' || !value.text.trim()) return null
    storage.removeItem(HANDOFF_KEY)
    return value.text
  } catch { return null }
}

export function koreanTranscriptForWriter(result = {}) {
  result = result && typeof result === 'object' ? result : {}
  if (hasKoreanTranslation(result)) return result.translatedTranscript.trim()
  if (/^(ko(?:[-_].*)?|kor|korean|한국어|한국말)$/i.test(String(result.sourceLanguage || '').trim())) {
    return String(result.originalTranscript || '').trim()
  }
  return ''
}
